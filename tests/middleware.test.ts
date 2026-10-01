import type { APIContext } from 'astro';
import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../src/middleware';

vi.mock('../src/adapters/auth/service', () => ({ getAuthService: vi.fn() }));

/** 没传 sessionId 时没有 Cookie；locals 是空对象，中间件写入的字段可以直接断言 */
function contextFor(path: string, sessionId?: string): APIContext {
  const locals: Record<string, unknown> = {};
  return {
    url: new URL(path, 'http://localhost'),
    cookies: { get: (name: string) => (name === 'home_session' && sessionId ? { value: sessionId } : undefined) },
    locals,
  } as unknown as APIContext;
}

describe('middleware', () => {
  it('forbids caching server island responses, which are rendered per user', async () => {
    // Arrange
    const upstream = new Response('<p>日程</p>', {
      headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=600', 'x-robots-tag': 'noindex' },
    });

    // Act
    const response = await onRequest(contextFor('/_server-islands/Live?e=a&p=b&s=c'), async () => upstream);

    // Assert
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('<p>日程</p>');
    // 返回的是新响应，原来的不动
    expect(upstream.headers.get('cache-control')).toBe('public, max-age=600');
  });

  it('keeps the status of island error responses', async () => {
    const rejected = new Response(null, { status: 400, statusText: 'Bad request' });
    const response = await onRequest(contextFor('/_server-islands/missing'), async () => rejected);
    expect(response).toMatchObject({ status: 400, statusText: 'Bad request' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('passes pages and API responses through untouched', async () => {
    for (const path of ['/', '/api/widgets/agenda/month', '/_server-islands-lookalike']) {
      const original = new Response('x', { headers: { 'cache-control': 'private, max-age=60' } });
      await expect(onRequest(contextFor(path), async () => original), path).resolves.toBe(original);
    }
  });

  it('leaves locals.auth unset when there is no session cookie', async () => {
    const context = contextFor('/');
    await onRequest(context, async () => new Response('x'));
    expect(context.locals.auth).toBeUndefined();
  });

  it('resolves a valid session cookie into locals.auth', async () => {
    const { getAuthService } = await import('../src/adapters/auth/service');
    const alice = { sessionId: 4, userId: 1, username: 'alice', displayName: '爱丽丝', role: 'admin' };
    vi.mocked(getAuthService).mockResolvedValue({
      currentUser: (token: string) => (token === 'good-session' ? alice : undefined),
    } as never);
    const context = contextFor('/', 'good-session');
    await onRequest(context, async () => new Response('x'));
    expect(context.locals.auth).toEqual(alice);
  });

  it('leaves locals.auth unset when the session cookie does not match any session', async () => {
    const { getAuthService } = await import('../src/adapters/auth/service');
    vi.mocked(getAuthService).mockResolvedValue({ currentUser: () => undefined } as never);
    const context = contextFor('/', 'expired-session');
    await onRequest(context, async () => new Response('x'));
    expect(context.locals.auth).toBeUndefined();
  });
});
