import tls from 'node:tls';
import { describe, expect, it, vi } from 'vitest';
import {
  ACCEPT,
  CalendarFetchError,
  fetchIcs,
  MAX_REDIRECTS,
  USER_AGENT,
} from '../../../src/adapters/calendar/fetch-ics';
import type { LookupFn } from '../../../src/adapters/calendar/url-guard';
import { UpstreamError } from '../../../src/core/http';

const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VCALENDAR', ''].join('\r\n');
// 用码点生成，免得不可见字符在编辑时丢失
const BOM = String.fromCharCode(0xfeff);
const SECRET_URL = 'https://calendar.example/calendar/ical/me%40example.com/private-0123abcd/basic.ics';

/** 默认所有主机都解析到公网地址，个别主机按表解析 */
function lookupWith(table: Readonly<Record<string, string>> = {}) {
  return vi.fn<LookupFn>(async (host) => [{ address: table[host] ?? '93.184.216.34', family: 4 }]);
}

/** 按顺序返回给定的响应 */
function respondWith(...responses: Response[]) {
  let index = 0;
  return vi.fn<typeof fetch>(async () => {
    const next = responses[index++];
    if (!next) throw new Error('unexpected request');
    return next;
  });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** 不带 content-length、分块到达的响应体 */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function failure(promise: Promise<unknown>): Promise<CalendarFetchError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CalendarFetchError);
  return error as CalendarFetchError;
}

describe('fetchIcs', () => {
  it('downloads the calendar like a browser and follows redirects itself', async () => {
    // Arrange
    const fetch = respondWith(new Response(ICS, { headers: { 'content-type': 'text/calendar; charset=utf-8' } }));

    // Act
    const text = await fetchIcs(SECRET_URL, { fetch, lookup: lookupWith() });

    // Assert
    expect(text).toBe(ICS);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(SECRET_URL);
    const headers = new Headers(init!.headers);
    expect(headers.get('user-agent')).toBe(USER_AGENT);
    expect(headers.get('accept')).toBe(ACCEPT);
    expect(init!.redirect).toBe('manual');
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('strips a byte-order mark and leading blank lines', async () => {
    const fetch = respondWith(new Response(`${BOM}\r\n\r\n${ICS}`));
    await expect(fetchIcs(SECRET_URL, { fetch, lookup: lookupWith() })).resolves.toBe(ICS);
  });

  it('follows up to three redirects, checking every hop', async () => {
    // Arrange
    const fetch = respondWith(
      redirect('https://a.example/one', 301),
      redirect('/two', 307),
      redirect('https://b.example/three', 308),
      new Response(ICS),
    );
    const lookup = lookupWith();

    // Act
    await fetchIcs(SECRET_URL, { fetch, lookup });

    // Assert
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      SECRET_URL,
      'https://a.example/one',
      'https://a.example/two',
      'https://b.example/three',
    ]);
    expect(lookup.mock.calls.map(([host]) => host)).toEqual([
      'calendar.example',
      'a.example',
      'a.example',
      'b.example',
    ]);
  });

  it('gives up after too many redirects', async () => {
    const hops = Array.from({ length: MAX_REDIRECTS + 1 }, (_, i) => redirect(`https://calendar.example/hop${i}`));
    const error = await failure(fetchIcs(SECRET_URL, { fetch: respondWith(...hops), lookup: lookupWith() }));
    expect(error).toMatchObject({ reason: 'redirects', host: 'calendar.example' });
  });

  it('refuses redirects into the local network', async () => {
    const lookup = lookupWith({ 'intranet.example': '10.0.0.8' });
    const viaDns = await failure(
      fetchIcs(SECRET_URL, { fetch: respondWith(redirect('https://intranet.example/x')), lookup }),
    );
    expect(viaDns).toMatchObject({ reason: 'blocked', host: 'intranet.example' });
    const literal = await failure(
      fetchIcs(SECRET_URL, { fetch: respondWith(redirect('https://127.0.0.1:8080/admin')), lookup }),
    );
    expect(literal).toMatchObject({ reason: 'blocked', host: '127.0.0.1:8080' });
  });

  it('refuses to follow a redirect down to plain http://', async () => {
    // Arrange
    const fetch = respondWith(redirect('http://calendar.example/calendar/ical/private-0123abcd/basic.ics'));

    // Act
    const error = await failure(fetchIcs(SECRET_URL, { fetch, lookup: lookupWith() }));

    // Assert
    expect(error).toMatchObject({ reason: 'redirects', host: 'calendar.example' });
    expect(error.message).toContain('http://');
    expect(error.message + JSON.stringify(error)).not.toContain('private-0123abcd');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reports redirects without a usable Location', async () => {
    const bare = respondWith(new Response(null, { status: 302 }));
    const error = await failure(fetchIcs(SECRET_URL, { fetch: bare, lookup: lookupWith() }));
    expect(error).toMatchObject({ reason: 'redirects', host: 'calendar.example' });
  });

  it('maps HTTP errors to Chinese messages without the address', async () => {
    const cases = [
      [404, /已失效/],
      [410, /已失效/],
      [401, /拒绝访问/],
      [403, /拒绝访问/],
      [429, /太频繁/],
      [500, /HTTP 500/],
    ] as const;
    for (const [status, message] of cases) {
      const fetch = respondWith(new Response('nope', { status }));
      const error = await failure(fetchIcs(SECRET_URL, { fetch, lookup: lookupWith() }));
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).toMatchObject({ reason: 'status', status, host: 'calendar.example' });
      expect(error.message).toMatch(message);
      expect(error.message + JSON.stringify(error)).not.toContain('private-0123abcd');
    }
  });

  it('rejects pages that are not calendars, such as sign-in pages', async () => {
    const fetch = respondWith(new Response('<!doctype html><title>Sign in</title>'));
    const error = await failure(fetchIcs(SECRET_URL, { fetch, lookup: lookupWith() }));
    expect(error).toMatchObject({ reason: 'not-ics', message: expect.stringContaining('ICS') });
  });

  it('stops reading bodies over the size limit, declared or streamed', async () => {
    // Arrange
    const cancelled = vi.fn();
    const declared = new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'content-length': String(10 * 1024 * 1024) },
    });
    const streamed = new Response(streamOf(ICS, 'X'.repeat(80)));

    // Act
    const big = await failure(fetchIcs(SECRET_URL, { fetch: respondWith(declared), lookup: lookupWith() }));
    const long = await failure(
      fetchIcs(SECRET_URL, { fetch: respondWith(streamed), lookup: lookupWith(), maxBytes: 64 }),
    );

    // Assert
    expect(big).toMatchObject({ reason: 'too-large', message: expect.stringContaining('5 MB') });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(long).toMatchObject({ reason: 'too-large', message: expect.stringContaining('64 字节') });
  });

  it('times out slow servers and slow DNS alike', async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))),
    );
    const slow = await failure(fetchIcs(SECRET_URL, { fetch: hang, lookup: lookupWith(), timeoutMs: 20 }));
    expect(slow).toMatchObject({ reason: 'timeout', host: 'calendar.example', message: expect.stringContaining('超时') });

    const stuck = vi.fn<LookupFn>(() => new Promise(() => {}));
    const dns = await failure(fetchIcs(SECRET_URL, { fetch: hang, lookup: stuck, timeoutMs: 20 }));
    expect(dns).toMatchObject({ reason: 'timeout' });
    expect(hang).toHaveBeenCalledOnce();
  });

  it('reports network failures with a safe error code only', async () => {
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(SECRET_URL), { code: 'ECONNREFUSED' }) });
    });
    const error = await failure(fetchIcs(SECRET_URL, { fetch: offline, lookup: lookupWith() }));
    expect(error).toMatchObject({ reason: 'network', host: 'calendar.example', detail: 'ECONNREFUSED' });
    expect(error.message + JSON.stringify(error)).not.toContain('private-0123abcd');
  });

  it('checks the address before sending anything', async () => {
    // Arrange
    const fetch = respondWith(new Response(ICS));
    const unresolvable = vi.fn<LookupFn>(async () => {
      throw new Error('ENOTFOUND');
    });

    // Act
    const dns = await failure(fetchIcs(SECRET_URL, { fetch, lookup: unresolvable }));
    const scheme = await failure(fetchIcs('ftp://calendar.example/a.ics', { fetch, lookup: lookupWith() }));
    const plain = await failure(fetchIcs('http://calendar.example/a.ics', { fetch, lookup: lookupWith() }));
    const inside = await failure(
      fetchIcs(SECRET_URL, { fetch, lookup: lookupWith({ 'calendar.example': '192.168.1.2' }) }),
    );

    // Assert
    expect(dns).toMatchObject({ reason: 'dns', host: 'calendar.example' });
    expect(scheme).toMatchObject({ reason: 'invalid-url' });
    expect(plain).toMatchObject({ reason: 'invalid-url' });
    expect(inside).toMatchObject({ reason: 'blocked' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('labels an unparseable address instead of echoing it back', async () => {
    // Arrange
    const fetch = respondWith(new Response(ICS));

    // Act
    const error = await failure(fetchIcs('not a url', { fetch, lookup: lookupWith() }));

    // Assert
    expect(error).toMatchObject({ reason: 'invalid-url', host: '(无效地址)' });
    expect(error.message).not.toContain('not a url');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rethrows the caller’s abort reason untouched', async () => {
    const controller = new AbortController();
    const reason = new Error('page closed');
    controller.abort(reason);
    await expect(
      fetchIcs(SECRET_URL, { fetch: respondWith(new Response(ICS)), lookup: lookupWith(), signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it('shares the classic TLS key exchange configured by core/http', () => {
    // 导入本模块就会导入 core/http，握手不会因为后量子密钥分段而卡住
    expect(tls.DEFAULT_ECDH_CURVE).toBe('X25519:prime256v1:secp384r1');
  });
});
