import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLinks } from '../../src/core/links';

vi.mock('../../src/adapters/link-visits', () => ({ recordVisit: vi.fn() }));
vi.mock('../../src/core/runtime', () => ({
  loadConfig: vi.fn(async () => ({
    links: parseLinks({ links: [{ name: 'GitHub', url: 'https://github.com' }, { name: 'B 站', url: 'https://www.bilibili.com' }] }),
  })),
}));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const ALICE: App.Locals['auth'] = { sessionId: 7, userId: 2, username: 'alice', displayName: null, role: 'user' };

/** 限流计数是模块级的：每个用例重新加载 */
async function setup() {
  vi.resetModules();
  const route = await import('../../src/pages/api/links/visit');
  const recordVisit = vi.mocked((await import('../../src/adapters/link-visits')).recordVisit);
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const post = (body: unknown, options: { auth?: App.Locals['auth']; headers?: Record<string, string> } = {}) => {
    // 显式传了 auth: undefined 就是没登录，不能被默认值顶掉
    const auth = 'auth' in options ? options.auth : ALICE;
    const headers = options.headers ?? SAME_ORIGIN;
    const url = new URL('/api/links/visit', 'http://localhost');
    const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return route.POST({ request, url, locals: { auth }, logger } as unknown as APIContext);
  };
  return { post, recordVisit };
}

let api: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  api = await setup();
});

describe('POST /api/links/visit', () => {
  it('records a link from links.yaml for the signed-in user', async () => {
    const response = await api.post({ url: 'https://github.com/' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { recorded: true }, error: null });
    expect(api.recordVisit).toHaveBeenCalledWith('alice', 'https://github.com/');
  });

  it('ignores addresses that are not in links.yaml, so the file never holds arbitrary text', async () => {
    const response = await api.post({ url: 'https://evil.example/' });

    expect(await response.json()).toEqual({ success: true, data: { recorded: false }, error: null });
    expect(api.recordVisit).not.toHaveBeenCalled();
  });

  it('refuses anonymous visitors, cross-site requests and malformed bodies', async () => {
    expect((await api.post({ url: 'https://github.com/' }, { auth: undefined })).status).toBe(401);
    expect((await api.post({ url: 'https://github.com/' }, { headers: { ...SAME_ORIGIN, 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await api.post({ link: 1 })).status).toBe(400);
    expect(api.recordVisit).not.toHaveBeenCalled();
  });

  it('has its own rate limit of 60 a minute', async () => {
    const statuses = [];
    for (let i = 0; i < 61; i += 1) statuses.push((await api.post({ url: 'https://github.com/' })).status);
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});
