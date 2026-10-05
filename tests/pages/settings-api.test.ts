import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/preferences', () => ({ updatePreferences: vi.fn() }));
vi.mock('../../src/adapters/calendar/service', () => ({ saveCalendarUrl: vi.fn(), clearCalendarUrl: vi.fn() }));
vi.mock('../../src/adapters/steam/service', () => ({ bindSteamAccount: vi.fn(), unbindSteamAccount: vi.fn() }));
vi.mock('../../src/adapters/geocoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/geocoding')>()),
  searchPlaces: vi.fn(),
}));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const JSON_HEADERS = { ...SAME_ORIGIN, 'content-type': 'application/json' };
const ALICE: App.Locals['auth'] = { sessionId: 7, userId: 2, username: 'alice', displayName: null, role: 'user' };

interface Call {
  readonly auth?: App.Locals['auth'];
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** 限流计数是模块级的：每个用例重新加载整张模块图，错误类型也从同一张图里取 */
async function setup() {
  vi.resetModules();
  const preferences = await import('../../src/pages/api/settings/preferences');
  const calendar = await import('../../src/pages/api/settings/calendar');
  const steam = await import('../../src/pages/api/settings/steam');
  const places = await import('../../src/pages/api/settings/places');
  const { ActionInputError } = await import('../../src/core/widget');
  const { UpstreamError } = await import('../../src/core/http');
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

  const context = (method: string, path: string, call: Call = {}) => {
    const { body, headers } = call;
    // 显式传了 auth: undefined 就是没登录，不能被默认值顶掉
    const auth = 'auth' in call ? call.auth : ALICE;
    const url = new URL(path, 'http://localhost');
    const init = { method, headers: headers ?? (body === undefined ? SAME_ORIGIN : JSON_HEADERS), body: body === undefined ? undefined : JSON.stringify(body) };
    return { request: new Request(url, init), url, locals: { auth }, logger } as unknown as APIContext;
  };

  return {
    patch: (call: Call) => preferences.PATCH(context('PATCH', '/api/settings/preferences', call)),
    saveCalendar: (call: Call) => calendar.PUT(context('PUT', '/api/settings/calendar', call)),
    clearCalendar: (call: Call = {}) => calendar.DELETE(context('DELETE', '/api/settings/calendar', call)),
    bindSteam: (call: Call) => steam.PUT(context('PUT', '/api/settings/steam', call)),
    unbindSteam: (call: Call = {}) => steam.DELETE(context('DELETE', '/api/settings/steam', call)),
    places: (q: string, call: Call = {}) => places.GET(context('GET', `/api/settings/places?${new URLSearchParams({ q })}`, call)),
    mocks: {
      updatePreferences: vi.mocked((await import('../../src/adapters/preferences')).updatePreferences),
      saveCalendarUrl: vi.mocked((await import('../../src/adapters/calendar/service')).saveCalendarUrl),
      clearCalendarUrl: vi.mocked((await import('../../src/adapters/calendar/service')).clearCalendarUrl),
      bindSteamAccount: vi.mocked((await import('../../src/adapters/steam/service')).bindSteamAccount),
      unbindSteamAccount: vi.mocked((await import('../../src/adapters/steam/service')).unbindSteamAccount),
      searchPlaces: vi.mocked((await import('../../src/adapters/geocoding')).searchPlaces),
    },
    logger,
    ActionInputError,
    UpstreamError,
  };
}

let api: Awaited<ReturnType<typeof setup>>;
const body = async (response: Response) => (await response.json()) as { success: boolean; data: unknown; error: string | null };

beforeEach(async () => {
  api = await setup();
});

describe('settings routes: shared checks', () => {
  it('rejects cross-site requests before anything else', async () => {
    const response = await api.patch({ body: { steam: null }, headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } });
    expect(response.status).toBe(403);
    expect(api.mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it('answers 401 to anonymous visitors', async () => {
    const response = await api.clearCalendar({ auth: undefined });
    expect(response.status).toBe(401);
    expect((await body(response)).error).toBe('请先登录');
  });

  it('accepts the user name injected by the reverse proxy when there is no site login', async () => {
    api.mocks.unbindSteamAccount.mockResolvedValue({ steamId: undefined });
    const response = await api.unbindSteam({ auth: undefined, headers: { ...SAME_ORIGIN, 'x-authenticated-user': 'bob' } });
    expect(response.status).toBe(200);
    expect(api.mocks.unbindSteamAccount).toHaveBeenCalledWith('bob');
  });

  it('rate limits each user', async () => {
    api.mocks.clearCalendarUrl.mockResolvedValue({ configured: false });
    const statuses = [];
    for (let i = 0; i < 31; i += 1) statuses.push((await api.clearCalendar()).status);
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('turns input errors into 400 with the message, upstream errors into 502 and the rest into a logged 500', async () => {
    api.mocks.bindSteamAccount.mockRejectedValueOnce(new api.ActionInputError('找不到这个自定义链接'));
    const bad = await api.bindSteam({ body: { account: 'nobody' } });
    expect([bad.status, (await body(bad)).error]).toEqual([400, '找不到这个自定义链接']);

    api.mocks.searchPlaces.mockRejectedValueOnce(new api.UpstreamError('geocoding-api.open-meteo.com 返回 HTTP 500', 500));
    expect((await api.places('坪山')).status).toBe(502);

    api.mocks.clearCalendarUrl.mockRejectedValueOnce(new Error('disk full'));
    const broken = await api.clearCalendar();
    expect([broken.status, (await body(broken)).error]).toEqual([500, '服务器内部错误']);
    expect(api.logger.error).toHaveBeenCalledTimes(2);
  });
});

describe('PATCH /api/settings/preferences', () => {
  it('saves the patch for the user and answers with just the patched types, null for defaults', async () => {
    api.mocks.updatePreferences.mockResolvedValue({ steam: { count: 6 }, weather: { label: '坪山', latitude: 1, longitude: 2 } });
    const response = await api.patch({ body: { steam: { count: 6 }, clock: null } });

    expect(api.mocks.updatePreferences).toHaveBeenCalledWith('alice', { steam: { count: 6 }, clock: null });
    expect(await body(response)).toEqual({ success: true, data: { steam: { count: 6 }, clock: null }, error: null });
  });

  it('wants a JSON object', async () => {
    expect((await api.patch({ body: ['steam'] })).status).toBe(400);
    expect((await api.patch({ body: { steam: null }, headers: SAME_ORIGIN })).status).toBe(415);
  });
});

describe('/api/settings/calendar and /api/settings/steam', () => {
  it('saves and clears the calendar subscription, answering with the host only', async () => {
    api.mocks.saveCalendarUrl.mockResolvedValue({ configured: true, host: 'calendar.example.com' });
    const saved = await api.saveCalendar({ body: { url: 'https://calendar.example.com/private/basic.ics' } });
    expect((await body(saved)).data).toEqual({ configured: true, host: 'calendar.example.com' });
    expect(api.mocks.saveCalendarUrl).toHaveBeenCalledWith('alice', 'https://calendar.example.com/private/basic.ics');
    expect((await api.saveCalendar({ body: {} })).status).toBe(400);
  });

  it('binds and unbinds the Steam account', async () => {
    api.mocks.bindSteamAccount.mockResolvedValue({ steamId: '76561197960265729' });
    const bound = await api.bindSteam({ body: { account: '76561197960265729' } });
    expect((await body(bound)).data).toEqual({ steamId: '76561197960265729' });
    expect((await api.bindSteam({ body: {} })).status).toBe(400);
  });
});

describe('GET /api/settings/places', () => {
  it('forwards the trimmed query and returns the places', async () => {
    const places = [{ name: '坪山', region: '深圳 · 广东 · 中国', latitude: 22.69, longitude: 114.33 }];
    api.mocks.searchPlaces.mockResolvedValue(places);
    const response = await api.places('  坪山 ');
    expect(api.mocks.searchPlaces).toHaveBeenCalledWith('坪山');
    expect((await body(response)).data).toEqual(places);
  });

  it('refuses empty and overlong queries without calling upstream', async () => {
    expect((await body(await api.places('  '))).error).toBe('请输入地名');
    expect((await api.places('坪'.repeat(61))).status).toBe(400);
    expect(api.mocks.searchPlaces).not.toHaveBeenCalled();
  });
});
