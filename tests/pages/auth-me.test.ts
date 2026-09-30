import type { APIContext } from 'astro';
import { describe, expect, it } from 'vitest';
import { GET } from '../../src/pages/api/auth/me';

async function call(auth: App.Locals['auth'], headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }): Promise<Response> {
  return GET({ request: new Request('http://localhost/api/auth/me', { headers }), locals: { auth } } as unknown as APIContext);
}

describe('GET /api/auth/me', () => {
  it('returns null when not signed in', async () => {
    const response = await call(undefined);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: null, error: null });
  });

  it('returns the username and role when signed in', async () => {
    const response = await call({ userId: 1, username: 'alice', role: 'admin' });
    await expect(response.json()).resolves.toEqual({ success: true, data: { username: 'alice', role: 'admin' }, error: null });
  });

  it('rejects cross-site requests', async () => {
    const response = await call(undefined, { 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
  });
});
