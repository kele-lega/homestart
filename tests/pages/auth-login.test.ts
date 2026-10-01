import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/auth/service', () => ({ getAuthService: vi.fn() }));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };

function jsonRequest(body: unknown, headers: Record<string, string> = SAME_ORIGIN): Request {
  return new Request('http://localhost/api/auth/login', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function setup() {
  vi.resetModules();
  const { POST } = await import('../../src/pages/api/auth/login');
  const { getAuthService } = await import('../../src/adapters/auth/service');
  const cookieStore = new Map<string, { value: string }>();
  const cookies = {
    set: vi.fn((name: string, value: string) => cookieStore.set(name, { value })),
    get: (name: string) => cookieStore.get(name),
    delete: vi.fn((name: string) => cookieStore.delete(name)),
  };
  const call = async (request: Request): Promise<Response> => POST({ request, cookies } as unknown as APIContext);
  return { call, cookies, getAuthService: vi.mocked(getAuthService) };
}

describe('POST /api/auth/login', () => {
  let api: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    api = await setup();
  });

  const signedIn = (remember: boolean) => ({
    token: 'abc123',
    remember,
    user: { sessionId: 5, userId: 1, username: 'alice', displayName: '爱丽丝', role: 'user' },
  });

  it('logs in and sets an HttpOnly session cookie that ends with the browser session', async () => {
    const login = vi.fn().mockResolvedValue(signedIn(false));
    api.getAuthService.mockResolvedValue({ login } as never);

    const response = await api.call(jsonRequest({ username: 'alice', password: 'password123' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { username: 'alice', displayName: '爱丽丝', role: 'user' },
      error: null,
    });
    expect(login).toHaveBeenCalledWith({ username: 'alice', password: 'password123', remember: false, userAgent: null, ip: null });
    const [name, value, options] = api.cookies.set.mock.calls[0]! as unknown as [string, string, Record<string, unknown>];
    expect([name, value]).toEqual(['home_session', 'abc123']);
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(options).not.toHaveProperty('maxAge');
  });

  it('keeps the cookie for 30 days when asked to remember, and records the device', async () => {
    const login = vi.fn().mockResolvedValue(signedIn(true));
    api.getAuthService.mockResolvedValue({ login } as never);
    const headers = { ...SAME_ORIGIN, 'user-agent': 'UA', 'x-forwarded-for': '203.0.113.4, 10.0.0.1' };

    await api.call(jsonRequest({ username: 'alice', password: 'password123', remember: true }, headers));

    expect(login).toHaveBeenCalledWith(expect.objectContaining({ remember: true, userAgent: 'UA', ip: '203.0.113.4' }));
    expect(api.cookies.set).toHaveBeenCalledWith('home_session', 'abc123', expect.objectContaining({ maxAge: 30 * 24 * 3600 }));
  });

  it('does not record a forwarded value that is not an IP address', async () => {
    const login = vi.fn().mockResolvedValue(signedIn(false));
    api.getAuthService.mockResolvedValue({ login } as never);
    await api.call(jsonRequest({ username: 'alice', password: 'password123' }, { ...SAME_ORIGIN, 'x-forwarded-for': '<script>' }));
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ ip: null }));
  });

  it('rejects a non-boolean remember flag', async () => {
    const response = await api.call(jsonRequest({ username: 'alice', password: 'password123', remember: 'yes' }));
    expect(response.status).toBe(400);
    expect(api.getAuthService).not.toHaveBeenCalled();
  });

  it('answers 400 with the service message on bad credentials', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    const login = vi.fn().mockRejectedValue(new AuthInputError('用户名或密码不对'));
    api.getAuthService.mockResolvedValue({ login } as never);

    const response = await api.call(jsonRequest({ username: 'alice', password: 'wrong' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, data: null, error: '用户名或密码不对' });
    expect(api.cookies.set).not.toHaveBeenCalled();
  });

  it('rejects missing fields with 400 before calling the service', async () => {
    const response = await api.call(jsonRequest({ username: 'alice' }));
    expect(response.status).toBe(400);
    expect(api.getAuthService).not.toHaveBeenCalled();
  });

  it('rejects cross-site requests', async () => {
    const response = await api.call(jsonRequest({ username: 'a', password: 'b' }, { 'sec-fetch-site': 'cross-site' }));
    expect(response.status).toBe(403);
  });

  it('rate-limits repeated attempts from the same client', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    const login = vi.fn().mockRejectedValue(new AuthInputError('用户名或密码不对'));
    api.getAuthService.mockResolvedValue({ login } as never);

    let status = 200;
    for (let i = 0; i < 20 && status !== 429; i += 1) {
      status = (await api.call(jsonRequest({ username: 'x', password: 'y' }))).status;
    }
    expect(status).toBe(429);
  });
});
