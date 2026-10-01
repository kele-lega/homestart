import { afterEach, describe, expect, it, vi } from 'vitest';
import { changePassword, fetchMe, login, logout, revokeOtherSessions, revokeSession } from '../../src/lib/auth-api';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../../src/lib/widget-api';

function stubFetch() {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ success: true, data: null, error: null }));
  vi.stubGlobal('fetch', fetch);
  return (index = 0) => {
    const [url, init] = fetch.mock.calls[index]!;
    return { url, method: init!.method, body: init!.body, headers: new Headers(init!.headers) };
  };
}

describe('auth-api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('declares JSON on bodiless writes so the origin check behind a proxy does not reject them', async () => {
    const sent = stubFetch();
    await logout();
    await revokeSession(4);
    await revokeOtherSessions();

    expect([sent(0), sent(1), sent(2)].map(({ url, method, body }) => [url, method, body])).toEqual([
      ['/api/auth/logout', 'POST', undefined],
      ['/api/account/sessions/4', 'DELETE', undefined],
      ['/api/account/sessions', 'DELETE', undefined],
    ]);
    for (const index of [0, 1, 2]) {
      expect(sent(index).headers.get('content-type')).toBe('application/json');
      expect(sent(index).headers.get(CLIENT_HEADER)).toBe(CLIENT_HEADER_VALUE);
    }
  });

  it('sends the remember flag with the credentials', async () => {
    const sent = stubFetch();
    await login('alice', 'pw', true);
    expect(sent().body).toBe('{"username":"alice","password":"pw","remember":true}');
  });

  it('sends the current and the new password', async () => {
    const sent = stubFetch();
    await changePassword('old', 'new');
    expect(sent()).toMatchObject({ url: '/api/account/password', method: 'POST', body: '{"current":"old","next":"new"}' });
  });

  it('reads without a content type', async () => {
    const sent = stubFetch();
    await fetchMe();
    expect(sent().method).toBe('GET');
    expect(sent().headers.has('content-type')).toBe(false);
  });
});
