import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionUrl, CLIENT_HEADER, CLIENT_HEADER_VALUE, fetchAction, sendAction } from '../../src/lib/widget-api';

describe('actionUrl', () => {
  it('encodes the widget id, action name and query', () => {
    expect(actionUrl('search', 'suggest', { q: 'a b&c' })).toBe('/api/widgets/search/suggest?q=a+b%26c');
    expect(actionUrl('my/id', 'run')).toBe('/api/widgets/my%2Fid/run');
  });
});

describe('fetchAction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the client header and returns the parsed body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ success: true, data: ['x'], error: null }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await expect(fetchAction('search', 'suggest', { q: 'x' }, signal)).resolves.toEqual({ success: true, data: ['x'], error: null });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/widgets/search/suggest?q=x');
    expect(new Headers(init!.headers).get(CLIENT_HEADER)).toBe(CLIENT_HEADER_VALUE);
    expect(init!.signal).toBe(signal);
  });
});

describe('sendAction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends a JSON body with the method, content type and client header', async () => {
    // Arrange
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ success: true, data: 1, error: null }));
    vi.stubGlobal('fetch', fetch);

    // Act
    const body = await sendAction('cal', 'subscribe', { method: 'PUT', body: { url: 'https://example.com/a.ics' } });

    // Assert
    expect(body).toEqual({ success: true, data: 1, error: null });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/widgets/cal/subscribe');
    expect(init!.method).toBe('PUT');
    expect(init!.body).toBe('{"url":"https://example.com/a.ics"}');
    const headers = new Headers(init!.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get(CLIENT_HEADER)).toBe(CLIENT_HEADER_VALUE);
  });

  it('omits the body and content type when there is nothing to send', async () => {
    // Arrange
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ success: true, data: null, error: null }));
    vi.stubGlobal('fetch', fetch);

    // Act
    await sendAction('cal', 'unsubscribe', { method: 'DELETE' });

    // Assert
    const [, init] = fetch.mock.calls[0]!;
    expect(init!.method).toBe('DELETE');
    expect(init!.body).toBeUndefined();
    expect(new Headers(init!.headers).has('content-type')).toBe(false);
  });
});
