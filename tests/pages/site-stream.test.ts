import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/site-stats', () => ({ siteCounts: vi.fn(), subscribeCounts: vi.fn() }));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };

async function setup() {
  vi.resetModules();
  const route = await import('../../src/pages/api/site/stream');
  const store = await import('../../src/adapters/site-stats');
  const listeners = new Set<(counts: { nav: number; search: number }) => void>();
  const unsubscribe = vi.fn();
  vi.mocked(store.siteCounts).mockResolvedValue({ nav: 3, search: 4 });
  vi.mocked(store.subscribeCounts).mockImplementation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscribe();
    };
  });
  const open = (headers: Record<string, string> = SAME_ORIGIN) => {
    const abort = new AbortController();
    const request = new Request('http://localhost/api/site/stream', { headers, signal: abort.signal });
    return { response: route.GET({ request } as unknown as APIContext) as Promise<Response>, abort };
  };
  const push = (counts: { nav: number; search: number }) => listeners.forEach((listener) => listener(counts));
  return { open, push, listeners, unsubscribe };
}

/** 读到流里出现 count 条 data 为止 */
async function readEvents(response: Response, count: number): Promise<{ events: unknown[]; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const events = () => [...text.matchAll(/^data: (.*)$/gm)].map((match) => JSON.parse(match[1]!) as unknown);
  while (events().length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return { events: events(), reader };
}

let api: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  api = await setup();
});

describe('GET /api/site/stream', () => {
  it('streams the current counts first, then every change', async () => {
    const { response } = api.open();
    const res = await response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const first = await readEvents(res, 1);
    expect(first.events).toEqual([{ nav: 3, search: 4 }]);
    first.reader.releaseLock();

    api.push({ nav: 5, search: 4 });
    const next = await readEvents(res, 1);
    expect(next.events).toEqual([{ nav: 5, search: 4 }]);
    await next.reader.cancel();
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the browser goes away', async () => {
    const { response, abort } = api.open();
    const res = await response;
    const { reader } = await readEvents(res, 1);
    expect(api.listeners.size).toBe(1);

    abort.abort();
    expect(api.listeners.size).toBe(0);
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
    await reader.cancel();
    // 中止以后又取消读，只清理一次
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-site requests', async () => {
    const { response } = api.open({ 'sec-fetch-site': 'cross-site' });
    expect((await response).status).toBe(403);
    expect(api.listeners.size).toBe(0);
  });

  it('turns new connections away with 503 past the limit, and frees slots when they close', async () => {
    const opened = [];
    for (let index = 0; index < 500; index += 1) opened.push(api.open());
    for (const { response } of opened) expect((await response).status).toBe(200);
    // start() 是异步的：等每条流都订阅上
    await vi.waitFor(() => expect(api.listeners.size).toBe(500));

    expect((await api.open().response).status).toBe(503);
    opened[0]!.abort.abort();
    expect((await api.open().response).status).toBe(200);
    for (const { abort } of opened) abort.abort();
  });
});
