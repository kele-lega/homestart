import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/auth/service', () => ({ getAuthService: vi.fn() }));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };

async function setup() {
  vi.resetModules();
  const { POST } = await import('../../src/pages/api/auth/logout');
  const { getAuthService } = await import('../../src/adapters/auth/service');
  const cookieStore = new Map<string, { value: string }>();
  const cookies = {
    get: (name: string) => cookieStore.get(name),
    delete: vi.fn((name: string) => cookieStore.delete(name)),
    _seed: (name: string, value: string) => cookieStore.set(name, { value }),
  };
  const call = async (headers: Record<string, string> = SAME_ORIGIN): Promise<Response> =>
    POST({ request: new Request('http://localhost/api/auth/logout', { method: 'POST', headers }), cookies } as unknown as APIContext);
  return { call, cookies, getAuthService: vi.mocked(getAuthService) };
}

describe('POST /api/auth/logout', () => {
  let api: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    api = await setup();
  });

  it('destroys the session and clears the cookie', async () => {
    api.cookies._seed('home_session', 'abc123');
    const logout = vi.fn();
    api.getAuthService.mockResolvedValue({ logout } as never);

    const response = await api.call();

    expect(response.status).toBe(200);
    expect(logout).toHaveBeenCalledWith('abc123');
    expect(api.cookies.delete).toHaveBeenCalledWith('home_session', expect.objectContaining({ path: '/' }));
  });

  it('succeeds even without a session cookie', async () => {
    const response = await api.call();
    expect(response.status).toBe(200);
    expect(api.getAuthService).not.toHaveBeenCalled();
    expect(api.cookies.delete).toHaveBeenCalled();
  });

  it('rejects cross-site requests', async () => {
    const response = await api.call({ 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
  });
});
