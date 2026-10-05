import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/site-stats', () => ({ siteCounts: vi.fn(), recordHit: vi.fn() }));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const JSON_HEADERS = { ...SAME_ORIGIN, 'content-type': 'application/json' };
const ALICE: App.Locals['auth'] = { sessionId: 20, userId: 2, username: 'alice', displayName: null, role: 'user' };

async function setup() {
  vi.resetModules();
  const route = await import('../../src/pages/api/site/stats');
  const store = await import('../../src/adapters/site-stats');
  const context = (request: Request, auth?: App.Locals['auth']) => ({ request, locals: { auth } }) as unknown as APIContext;
  const get = (headers: Record<string, string> = SAME_ORIGIN) =>
    route.GET(context(new Request('http://localhost/api/site/stats', { headers })));
  const hit = (body: unknown, { auth, ip, headers = JSON_HEADERS }: { auth?: App.Locals['auth']; ip?: string; headers?: Record<string, string> } = {}) =>
    route.POST(
      context(
        new Request('http://localhost/api/site/stats', {
          method: 'POST',
          headers: { ...headers, ...(ip ? { 'x-forwarded-for': ip } : {}) },
          body: JSON.stringify(body),
        }),
        auth,
      ),
    );
  return { get, hit, siteCounts: vi.mocked(store.siteCounts), recordHit: vi.mocked(store.recordHit) };
}

let api: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  api = await setup();
  api.siteCounts.mockResolvedValue({ nav: 3, search: 4 });
  api.recordHit.mockResolvedValue({ nav: 4, search: 4 });
});

describe('/api/site/stats', () => {
  it('shows the counts to anyone', async () => {
    const response = await api.get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { nav: 3, search: 4 }, error: null });
  });

  it('counts anonymous and signed-in hits and returns the new totals', async () => {
    expect(await (await api.hit({ kind: 'nav' }, { ip: '203.0.113.9' })).json()).toMatchObject({ data: { nav: 4, search: 4 } });
    await api.hit({ kind: 'search' }, { auth: ALICE });
    expect(api.recordHit.mock.calls).toEqual([['nav'], ['search']]);
  });

  it('rejects unknown kinds and cross-site requests', async () => {
    expect((await api.hit({ kind: 'visit' })).status).toBe(400);
    expect((await api.hit({ kind: 'nav' }, { headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } })).status).toBe(403);
    expect((await api.get({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(api.recordHit).not.toHaveBeenCalled();
  });

  it('limits each address, and does not count the rejected hits', async () => {
    for (let index = 0; index < 60; index += 1) expect((await api.hit({ kind: 'nav' }, { ip: '203.0.113.9' })).status).toBe(200);
    expect((await api.hit({ kind: 'nav' }, { ip: '203.0.113.9' })).status).toBe(429);
    expect((await api.hit({ kind: 'nav' }, { ip: '203.0.113.10' })).status).toBe(200);
    expect(api.recordHit).toHaveBeenCalledTimes(61);
  });
});
