import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/auth/service', () => ({ getAuthService: vi.fn() }));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const JSON_HEADERS = { ...SAME_ORIGIN, 'content-type': 'application/json' };
const ALICE: App.Locals['auth'] = { sessionId: 7, userId: 2, username: 'alice', displayName: null, role: 'user' };
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

type Auth = App.Locals['auth'];

async function setup() {
  vi.resetModules();
  const profile = await import('../../src/pages/api/account/profile');
  const password = await import('../../src/pages/api/account/password');
  const sessions = await import('../../src/pages/api/account/sessions');
  const session = await import('../../src/pages/api/account/sessions/[id]');
  const { getAuthService } = await import('../../src/adapters/auth/service');

  const context = (
    auth: Auth,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = body === undefined ? SAME_ORIGIN : JSON_HEADERS,
  ) =>
    ({
      request: new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      locals: { auth },
      params: { id: path.split('/').at(-1) },
    }) as unknown as APIContext;

  return {
    patchProfile: (auth: Auth, body: unknown) => profile.PATCH(context(auth, 'PATCH', '/api/account/profile', body)),
    changePassword: (auth: Auth, body: unknown) => password.POST(context(auth, 'POST', '/api/account/password', body)),
    listSessions: (auth: Auth, headers?: Record<string, string>) =>
      sessions.GET(context(auth, 'GET', '/api/account/sessions', undefined, headers)),
    revokeOthers: (auth: Auth) => sessions.DELETE(context(auth, 'DELETE', '/api/account/sessions')),
    revokeOne: (auth: Auth, id: string) => session.DELETE(context(auth, 'DELETE', `/api/account/sessions/${id}`)),
    getAuthService: vi.mocked(getAuthService),
  };
}

let api: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  api = await setup();
});

describe('signed-out and cross-site requests', () => {
  it('answers 401 to every account route without calling the service', async () => {
    const responses = await Promise.all([
      api.patchProfile(undefined, { displayName: 'x' }),
      api.changePassword(undefined, { current: 'a', next: 'b' }),
      api.listSessions(undefined),
      api.revokeOthers(undefined),
      api.revokeOne(undefined, '3'),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    expect(api.getAuthService).not.toHaveBeenCalled();
  });

  it('rejects cross-site requests', async () => {
    const response = await api.listSessions(ALICE, { 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/account/profile', () => {
  it('updates the display name and returns the normalized value', async () => {
    const updateDisplayName = vi.fn().mockReturnValue('爱丽丝');
    api.getAuthService.mockResolvedValue({ updateDisplayName } as never);
    const response = await api.patchProfile(ALICE, { displayName: '  爱丽丝 ' });
    expect(updateDisplayName).toHaveBeenCalledWith(ALICE!.userId, '  爱丽丝 ');
    await expect(response.json()).resolves.toEqual({ success: true, data: { displayName: '爱丽丝' }, error: null });
  });

  it('surfaces a validation error as 400', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    api.getAuthService.mockResolvedValue({
      updateDisplayName: () => {
        throw new AuthInputError('昵称最多 32 个字');
      },
    } as never);
    const response = await api.patchProfile(ALICE, { displayName: 'x' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: '昵称最多 32 个字' });
  });

  it('rejects a body without displayName before calling the service', async () => {
    const response = await api.patchProfile(ALICE, {});
    expect(response.status).toBe(400);
    expect(api.getAuthService).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/password', () => {
  it('changes the password for the current session and reports signed-out devices', async () => {
    const changePassword = vi.fn().mockResolvedValue(2);
    api.getAuthService.mockResolvedValue({ changePassword } as never);
    const response = await api.changePassword(ALICE, { current: 'password123', next: 'newpassword1' });
    expect(changePassword).toHaveBeenCalledWith(ALICE, 'password123', 'newpassword1');
    await expect(response.json()).resolves.toEqual({ success: true, data: { signedOut: 2 }, error: null });
  });

  it('answers 400 when the current password is wrong', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    api.getAuthService.mockResolvedValue({ changePassword: vi.fn().mockRejectedValue(new AuthInputError('当前密码不对')) } as never);
    const response = await api.changePassword(ALICE, { current: 'nope', next: 'newpassword1' });
    expect(response.status).toBe(400);
  });

  it('rate-limits guesses at the current password per user', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    api.getAuthService.mockResolvedValue({ changePassword: vi.fn().mockRejectedValue(new AuthInputError('当前密码不对')) } as never);
    let status = 400;
    for (let i = 0; i < 20 && status !== 429; i += 1) {
      status = (await api.changePassword(ALICE, { current: `guess-${i}`, next: 'newpassword1' })).status;
    }
    expect(status).toBe(429);
  });
});

describe('GET /api/account/sessions', () => {
  it('lists devices with a readable name, marks the current one and never sends the raw user agent', async () => {
    const rows = [
      { id: 7, userAgent: CHROME_WINDOWS, ip: '203.0.113.2', remember: true, createdAt: 1, lastSeenAt: 3, expiresAt: 9 },
      { id: 8, userAgent: null, ip: null, remember: false, createdAt: 2, lastSeenAt: 2, expiresAt: 9 },
    ];
    const listSessions = vi.fn().mockReturnValue(rows);
    api.getAuthService.mockResolvedValue({ listSessions } as never);

    const response = await api.listSessions(ALICE);
    const body = await response.json();

    expect(listSessions).toHaveBeenCalledWith(ALICE!.userId);
    expect(body.data).toEqual([
      { id: 7, device: 'Chrome · Windows', ip: '203.0.113.2', remember: true, createdAt: 1, lastSeenAt: 3, current: true },
      { id: 8, device: '未知设备', ip: null, remember: false, createdAt: 2, lastSeenAt: 2, current: false },
    ]);
    expect(JSON.stringify(body)).not.toContain('Mozilla');
  });
});

describe('DELETE /api/account/sessions', () => {
  it('signs out every other device', async () => {
    const revokeOtherSessions = vi.fn().mockReturnValue(3);
    api.getAuthService.mockResolvedValue({ revokeOtherSessions } as never);
    const response = await api.revokeOthers(ALICE);
    expect(revokeOtherSessions).toHaveBeenCalledWith(ALICE);
    await expect(response.json()).resolves.toEqual({ success: true, data: { signedOut: 3 }, error: null });
  });
});

describe('DELETE /api/account/sessions/[id]', () => {
  it('signs out that device', async () => {
    const revokeSession = vi.fn();
    api.getAuthService.mockResolvedValue({ revokeSession } as never);
    const response = await api.revokeOne(ALICE, '9');
    expect(response.status).toBe(200);
    expect(revokeSession).toHaveBeenCalledWith(ALICE, 9);
  });

  it('answers 404 for an id that is not a positive integer', async () => {
    for (const id of ['nope', '0', '-1', '1.5']) {
      expect((await api.revokeOne(ALICE, id)).status, id).toBe(404);
    }
    expect(api.getAuthService).not.toHaveBeenCalled();
  });

  it('surfaces the refusal to revoke the current device as 400', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    api.getAuthService.mockResolvedValue({
      revokeSession: () => {
        throw new AuthInputError('这是当前设备，要退出请点「登出」');
      },
    } as never);
    const response = await api.revokeOne(ALICE, String(ALICE!.sessionId));
    expect(response.status).toBe(400);
  });
});
