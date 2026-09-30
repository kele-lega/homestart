import { resolve } from 'node:path';
import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../../src/lib/widget-api';

vi.mock('../../src/core/runtime', () => ({ loadConfig: vi.fn() }));
vi.mock('../../src/widgets/search/suggest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/widgets/search/suggest')>()),
  fetchSuggestions: vi.fn(),
}));

// 专用的最小布局：覆盖「配置 → 注册表 → 操作」整条链路，又不受真实 config/ 改动影响
const FIXTURE = resolve('tests/fixtures/api-config');
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const as = (user: string) => ({ ...SAME_ORIGIN, 'x-authenticated-user': user });

/**
 * 路由模块里有限流计数，联想缓存也是模块级的。每个用例重新加载整张模块图，
 * 用例之间互不影响、不依赖执行顺序；错误类型和注册表都从同一张新图里取，instanceof 才成立。
 */
async function setup() {
  vi.resetModules();
  const { GET } = await import('../../src/pages/api/widgets/[id]/[action]');
  const { registry } = await import('../../src/core/registry');
  const { createConfigLoader } = await import('../../src/core/config');
  const { ConfigError } = await import('../../src/core/config-error');
  const { UpstreamError } = await import('../../src/core/http');
  const loadConfig = vi.mocked((await import('../../src/core/runtime')).loadConfig);
  const fetchSuggestions = vi.mocked((await import('../../src/widgets/search/suggest')).fetchSuggestions);
  loadConfig.mockReset().mockImplementation(createConfigLoader(FIXTURE, registry));
  fetchSuggestions.mockReset().mockImplementation(async (_provider, q) => [`${q} docs`]);

  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const call = async (path: string, headers: Record<string, string> = SAME_ORIGIN): Promise<Response> => {
    const url = new URL(path, 'http://localhost');
    const [, , , id, action] = url.pathname.split('/');
    const context = { params: { id, action }, request: new Request(url, { headers }), url, logger, locals: {} };
    return GET(context as unknown as APIContext);
  };
  return { call, logger, loadConfig, fetchSuggestions, ConfigError, UpstreamError };
}

describe('GET /api/widgets/[id]/[action]', () => {
  let api: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    api = await setup();
  });

  it('runs the widget action and returns the envelope with private caching', async () => {
    const response = await api.call('/api/widgets/search/suggest?q=Astro');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    await expect(response.json()).resolves.toEqual({ success: true, data: ['astro docs'], error: null });
  });

  it('logs upstream failures on the server and answers 502 without internal details', async () => {
    api.fetchSuggestions.mockRejectedValueOnce(new api.UpstreamError('www.bing.com 返回 HTTP 500', 500));
    // 和上一个用例同一个词：缓存随模块图一起重建，上一个结果挡不住这次失败
    const response = await api.call('/api/widgets/search/suggest?q=Astro');
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ success: false, data: null, error: '外部服务暂时不可用' });
    expect(api.logger.error).toHaveBeenCalledWith(expect.stringContaining('search/suggest'));
  });

  it('rate-limits each signed-in user separately', async () => {
    let status = 200;
    for (let i = 0; i < 200 && status !== 429; i += 1) {
      status = (await api.call('/api/widgets/search/suggest?q=a', as('alice'))).status;
    }
    expect(status).toBe(429);
    expect((await api.call('/api/widgets/search/suggest?q=a', as('bob'))).status).toBe(200);
  });

  it('accepts browsers without Sec-Fetch-Site only when they send the client header', async () => {
    expect((await api.call('/api/widgets/search/suggest?q=a', {})).status).toBe(403);
    const scripted = await api.call('/api/widgets/search/suggest?q=a', { [CLIENT_HEADER]: CLIENT_HEADER_VALUE });
    expect(scripted.status).toBe(200);
  });

  it('rejects other sites and address-bar visits before touching the config', async () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      const response = await api.call('/api/widgets/search/suggest?q=a', { 'sec-fetch-site': site });
      expect(response.status).toBe(403);
    }
    expect(api.loadConfig).not.toHaveBeenCalled();
  });

  it('warns once per kind of rejected request and never logs a forged header verbatim', async () => {
    const kinds: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'none' },
      { 'sec-fetch-site': 'x [ERROR] forged' },
      {},
      {},
    ];
    for (const headers of kinds) {
      expect((await api.call('/api/widgets/search/suggest?q=a', headers)).status).toBe(403);
    }
    const lines = api.logger.warn.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(4);
    expect(lines.some((line) => line.includes('cross-site'))).toBe(true);
    expect(lines.join('\n')).not.toContain('forged');
    expect(api.logger.error).not.toHaveBeenCalled();
  });

  it('maps unknown widgets and missing actions to 404 and invalid queries to 400', async () => {
    expect((await api.call('/api/widgets/nope/suggest?q=a')).status).toBe(404);
    expect((await api.call('/api/widgets/search/nope?q=a')).status).toBe(404);
    expect((await api.call('/api/widgets/note/suggest?q=a')).status).toBe(404);
    expect((await api.call('/api/widgets/search/suggest')).status).toBe(400);
  });

  it('answers 503 on config errors but lets unexpected failures surface', async () => {
    api.loadConfig.mockRejectedValueOnce(new api.ConfigError('layout.yaml', ['坏了']));
    const broken = await api.call('/api/widgets/search/suggest?q=a');
    expect(broken.status).toBe(503);
    await expect(broken.json()).resolves.toMatchObject({ success: false, data: null });
    api.loadConfig.mockRejectedValueOnce(new Error('disk on fire'));
    await expect(api.call('/api/widgets/search/suggest?q=a')).rejects.toThrow('disk on fire');
  });
});
