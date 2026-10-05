import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemStats } from '../../src/adapters/system-stats';

vi.mock('../../src/adapters/system-stats', () => ({ readSystemStats: vi.fn() }));

const { GET } = await import('../../src/pages/api/server/stats');
const { readSystemStats } = await import('../../src/adapters/system-stats');

const GB = 1024 ** 3;
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const ADMIN: App.Locals['auth'] = { sessionId: 1, userId: 1, username: 'root', displayName: null, role: 'admin' };
const ALICE: App.Locals['auth'] = { sessionId: 7, userId: 2, username: 'alice', displayName: null, role: 'user' };

const STATS: SystemStats = {
  cpu: { model: 'Test CPU', cores: 4, usage: 0.5, load: [1, 1, 1] },
  memory: { total: 8 * GB, used: 2 * GB, available: 6 * GB, cache: 1 * GB, swap: undefined },
  disk: { mount: '/', total: 100 * GB, used: 30 * GB, available: 70 * GB },
  uptime: 3600,
};

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

function call(auth: App.Locals['auth'], headers: Record<string, string> = SAME_ORIGIN) {
  const url = new URL('/api/server/stats', 'http://localhost');
  return GET({ request: new Request(url, { headers }), url, locals: { auth }, logger } as unknown as APIContext) as Promise<Response>;
}

beforeEach(() => {
  vi.mocked(readSystemStats).mockReset().mockResolvedValue(STATS);
  logger.error.mockReset();
});

describe('GET /api/server/stats', () => {
  it('gives an admin the three gauges, never cached', async () => {
    const response = await call(ADMIN);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.data.uptime).toBe('已运行 1 小时');
    expect(body.data.gauges.map((g: { percent: number }) => g.percent)).toEqual([50, 25, 30]);
  });

  it('refuses ordinary users and anonymous visitors without reading anything', async () => {
    for (const auth of [ALICE, undefined]) {
      const response = await call(auth);

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('只有管理员可以查看服务器状态');
    }
    expect(readSystemStats).not.toHaveBeenCalled();
  });

  it('does not trust a proxy username header in place of a session', async () => {
    const response = await call(undefined, { ...SAME_ORIGIN, 'x-authenticated-user': 'root' });

    expect(response.status).toBe(403);
  });

  it('rejects cross-site requests even from an admin session', async () => {
    const response = await call(ADMIN, { 'sec-fetch-site': 'cross-site' });

    expect(response.status).toBe(403);
    expect(readSystemStats).not.toHaveBeenCalled();
  });

  it('logs a failed read and returns a short message', async () => {
    vi.mocked(readSystemStats).mockRejectedValueOnce(new Error('EACCES /proc/meminfo'));

    const response = await call(ADMIN);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('服务器状态暂时读不到');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });
});
