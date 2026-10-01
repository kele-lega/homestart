import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/auth/service', () => ({ getAuthService: vi.fn() }));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const JSON_HEADERS = { ...SAME_ORIGIN, 'content-type': 'application/json' };
const ADMIN: App.Locals['auth'] = { sessionId: 10, userId: 1, username: 'root', displayName: null, role: 'admin' };
const USER: App.Locals['auth'] = { sessionId: 20, userId: 2, username: 'alice', displayName: null, role: 'user' };

async function setup() {
  vi.resetModules();
  const usersModule = await import('../../src/pages/api/auth/users');
  const idModule = await import('../../src/pages/api/auth/users/[id]');
  const { getAuthService } = await import('../../src/adapters/auth/service');
  const list = (auth: App.Locals['auth']) =>
    usersModule.GET({ request: new Request('http://localhost/api/auth/users', { headers: SAME_ORIGIN }), locals: { auth } } as unknown as APIContext);
  const create = (auth: App.Locals['auth'], body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
    usersModule.POST({
      request: new Request('http://localhost/api/auth/users', { method: 'POST', headers, body: JSON.stringify(body) }),
      locals: { auth },
    } as unknown as APIContext);
  const resetPassword = (auth: App.Locals['auth'], id: string, body: unknown) =>
    idModule.PUT({
      request: new Request(`http://localhost/api/auth/users/${id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }),
      locals: { auth },
      params: { id },
    } as unknown as APIContext);
  const remove = (auth: App.Locals['auth'], id: string) =>
    idModule.DELETE({
      request: new Request(`http://localhost/api/auth/users/${id}`, { method: 'DELETE', headers: SAME_ORIGIN }),
      locals: { auth },
      params: { id },
    } as unknown as APIContext);
  return { list, create, resetPassword, remove, getAuthService: vi.mocked(getAuthService) };
}

describe('GET /api/auth/users', () => {
  let api: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    api = await setup();
  });

  it('lists users for an admin with the last login time but not its IP', async () => {
    const lastLogin = { at: 1234, ip: '203.0.113.8' };
    const row = { id: 1, username: 'root', displayName: '根', role: 'admin', createdAt: 0, lastLogin };
    api.getAuthService.mockResolvedValue({ listUsers: () => [row] } as never);
    const response = await api.list(ADMIN);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      data: [{ id: 1, username: 'root', displayName: '根', role: 'admin', createdAt: 0, lastLoginAt: 1234 }],
      error: null,
    });
    expect(JSON.stringify(body)).not.toContain('203.0.113.8');
  });

  it('rejects a non-admin user', async () => {
    const response = await api.list(USER);
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await api.list(undefined);
    expect(response.status).toBe(403);
  });
});

describe('POST /api/auth/users', () => {
  let api: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    api = await setup();
  });

  it('creates a user for an admin', async () => {
    const createUser = vi.fn().mockResolvedValue(undefined);
    api.getAuthService.mockResolvedValue({ createUser } as never);
    const response = await api.create(ADMIN, { username: 'newbie', password: 'password123', role: 'user' });
    expect(response.status).toBe(200);
    expect(createUser).toHaveBeenCalledWith('newbie', 'password123', 'user');
  });

  it('rejects a non-admin user without calling the service', async () => {
    const response = await api.create(USER, { username: 'newbie', password: 'password123', role: 'user' });
    expect(response.status).toBe(403);
    expect(api.getAuthService).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate-username error as 400', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    const createUser = vi.fn().mockRejectedValue(new AuthInputError('用户名已经被使用'));
    api.getAuthService.mockResolvedValue({ createUser } as never);
    const response = await api.create(ADMIN, { username: 'dup', password: 'password123', role: 'user' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: '用户名已经被使用' });
  });

  it('rejects an invalid role before calling the service', async () => {
    const response = await api.create(ADMIN, { username: 'x', password: 'password123', role: 'superadmin' });
    expect(response.status).toBe(400);
    expect(api.getAuthService).not.toHaveBeenCalled();
  });
});

describe('PUT /api/auth/users/[id]', () => {
  let api: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    api = await setup();
  });

  it('resets a password for an admin, passing who did it so their own device survives', async () => {
    const resetPassword = vi.fn().mockResolvedValue(undefined);
    api.getAuthService.mockResolvedValue({ resetPassword } as never);
    const response = await api.resetPassword(ADMIN, '2', { password: 'newpassword1' });
    expect(response.status).toBe(200);
    expect(resetPassword).toHaveBeenCalledWith(2, 'newpassword1', ADMIN);
  });

  it('rejects a non-admin', async () => {
    const response = await api.resetPassword(USER, '2', { password: 'newpassword1' });
    expect(response.status).toBe(403);
  });

  it('answers 404 for a non-numeric id', async () => {
    const response = await api.resetPassword(ADMIN, 'nope', { password: 'newpassword1' });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/auth/users/[id]', () => {
  let api: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    api = await setup();
  });

  it('deletes another user for an admin', async () => {
    const deleteUser = vi.fn();
    api.getAuthService.mockResolvedValue({ deleteUser } as never);
    const response = await api.remove(ADMIN, '2');
    expect(response.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith(2, ADMIN.userId);
  });

  it('surfaces a self-delete refusal as 400', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    const deleteUser = vi.fn().mockImplementation(() => {
      throw new AuthInputError('不能删除自己的账号');
    });
    api.getAuthService.mockResolvedValue({ deleteUser } as never);
    const response = await api.remove(ADMIN, String(ADMIN.userId));
    expect(response.status).toBe(400);
  });

  it('rejects a non-admin', async () => {
    const response = await api.remove(USER, '2');
    expect(response.status).toBe(403);
  });
});
