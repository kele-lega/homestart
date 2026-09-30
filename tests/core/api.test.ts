import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  ANONYMOUS,
  fail,
  fetchSiteLabel,
  isCrossSite,
  json,
  MAX_BODY_BYTES,
  ok,
  readJsonBody,
  userFrom,
} from '../../src/core/api';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../../src/lib/widget-api';

describe('json', () => {
  it('serializes the envelope and allows private caching only for successful results', async () => {
    const cached = json(200, ok(['a']), 60);
    expect(cached.headers.get('cache-control')).toBe('private, max-age=60');
    expect(cached.headers.get('content-type')).toContain('application/json');
    expect(cached.headers.get('access-control-allow-origin')).toBeNull();
    await expect(cached.json()).resolves.toEqual({ success: true, data: ['a'], error: null });

    expect(json(200, ok(1)).headers.get('cache-control')).toBe('no-store');
    const failed = json(502, fail('down'), 60);
    expect(failed.status).toBe(502);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    await expect(failed.json()).resolves.toEqual({ success: false, data: null, error: 'down' });
  });

  it('adds extra headers but never lets them override the fixed ones, whatever their case', () => {
    // Arrange
    const extra = {
      allow: 'PUT',
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=999',
      'X-Content-Type-Options': 'sniff',
    };

    // Act
    const response = json(405, fail('x'), 0, extra);

    // Assert
    expect(response.headers.get('allow')).toBe('PUT');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('userFrom', () => {
  // 开发机的 shell 里可能设置了 HOME_DEV_USER，这组用例按“没有设置”来测
  beforeEach(() => {
    vi.stubEnv('HOME_DEV_USER', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers the signed-in session over the proxy header when both are present', () => {
    expect(userFrom(new Headers({ 'x-authenticated-user': 'alice' }), { username: 'bob' })).toBe('bob');
    expect(userFrom(new Headers(), { username: 'bob' })).toBe('bob');
  });

  it('reads the proxy-injected user and falls back to anonymous for missing or odd values', () => {
    expect(userFrom(new Headers({ 'x-authenticated-user': ' alice ' }))).toBe('alice');
    expect(userFrom(new Headers())).toBe(ANONYMOUS);
    expect(userFrom(new Headers({ 'x-authenticated-user': 'a/b' }))).toBe(ANONYMOUS);
    expect(userFrom(new Headers({ 'x-authenticated-user': 'x'.repeat(65) }))).toBe(ANONYMOUS);
  });

  it('never lets a real account named anonymous share the fallback identity', () => {
    expect(userFrom(new Headers({ 'x-authenticated-user': 'anonymous' }))).toBe('anonymous');
    expect(userFrom(new Headers({ 'x-authenticated-user': 'anonymous' }))).not.toBe(ANONYMOUS);
  });
});

describe('userFrom with HOME_DEV_USER', () => {
  const original = process.env.HOME_DEV_USER;
  let warn: MockInstance<typeof console.warn>;

  /** “只警告一次”记在模块里：每个用例重新加载一份，互不影响 */
  async function freshUserFrom() {
    vi.resetModules();
    return (await import('../../src/core/api')).userFrom;
  }

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    // unstubAllEnvs 把 process.env 恢复成用例之前的样子
    expect(process.env.HOME_DEV_USER).toBe(original);
  });

  it('acts as the development user when the identity header is missing and warns only once', async () => {
    // Arrange
    vi.stubEnv('HOME_DEV_USER', '  dev-user  ');
    const devUserFrom = await freshUserFrom();

    // Act
    const users = [devUserFrom(new Headers()), devUserFrom(new Headers())];

    // Assert
    expect(users).toEqual(['dev-user', 'dev-user']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HOME_DEV_USER=dev-user'));
  });

  it('prefers the identity header, and an invalid header stays anonymous instead of becoming the dev user', async () => {
    // Arrange
    vi.stubEnv('HOME_DEV_USER', 'dev-user');
    const devUserFrom = await freshUserFrom();
    const headers = ['alice', '', '   ', 'a/b', 'x'.repeat(65)];

    // Act
    const users = headers.map((value) => devUserFrom(new Headers({ 'x-authenticated-user': value })));

    // Assert
    expect(users).toEqual(['alice', ANONYMOUS, ANONYMOUS, ANONYMOUS, ANONYMOUS]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores an invalid HOME_DEV_USER value', async () => {
    // Arrange
    const devUserFrom = await freshUserFrom();
    const values = ['', '   ', 'dev user', 'a/b', '(anonymous)', 'x'.repeat(65)];

    // Act
    const users = values.map((value) => {
      vi.stubEnv('HOME_DEV_USER', value);
      return devUserFrom(new Headers());
    });

    // Assert
    expect(users).toEqual(values.map(() => ANONYMOUS));
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the old behaviour when HOME_DEV_USER is unset', async () => {
    // Arrange
    vi.stubEnv('HOME_DEV_USER', undefined);
    const devUserFrom = await freshUserFrom();

    // Act
    const users = [devUserFrom(new Headers()), devUserFrom(new Headers({ 'x-authenticated-user': 'alice' }))];

    // Assert
    expect(users).toEqual([ANONYMOUS, 'alice']);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('isCrossSite', () => {
  const site = (value: string) => new Headers({ 'sec-fetch-site': value });

  it('allows only same-origin requests and rejects other sites and address-bar navigations', () => {
    expect(isCrossSite(site('same-origin'))).toBe(false);
    // none：地址栏、书签或其它应用里点开的链接；页面脚本从不发出这种请求
    expect(isCrossSite(site('none'))).toBe(true);
    expect(isCrossSite(site('same-site'))).toBe(true);
    expect(isCrossSite(site('cross-site'))).toBe(true);
  });

  it('requires the client header when the browser sends no Sec-Fetch-Site (plain HTTP, old Safari)', () => {
    expect(isCrossSite(new Headers())).toBe(true);
    expect(isCrossSite(new Headers({ [CLIENT_HEADER]: CLIENT_HEADER_VALUE }))).toBe(false);
    expect(isCrossSite(new Headers({ [CLIENT_HEADER]: 'other' }))).toBe(true);
    // 浏览器明确标成跨站时，带上这个头也不行
    expect(isCrossSite(new Headers({ 'sec-fetch-site': 'cross-site', [CLIENT_HEADER]: CLIENT_HEADER_VALUE }))).toBe(true);
  });
});

describe('fetchSiteLabel', () => {
  it('names the Sec-Fetch-Site value the browser sent', () => {
    for (const value of ['cross-site', 'same-site', 'same-origin', 'none']) {
      expect(fetchSiteLabel(new Headers({ 'sec-fetch-site': value }))).toBe(value);
    }
  });

  it('never echoes values outside the spec, so a forged header cannot write into the log', () => {
    expect(fetchSiteLabel(new Headers({ 'sec-fetch-site': 'x [ERROR] forged' }))).toBe('(invalid)');
    expect(fetchSiteLabel(new Headers({ 'sec-fetch-site': 'CROSS-SITE' }))).toBe('(invalid)');
    expect(fetchSiteLabel(new Headers())).toBe('(missing)');
  });
});

describe('readJsonBody', () => {
  const JSON_TYPE = { 'content-type': 'application/json' };
  const request = (body: BodyInit | null, headers: Record<string, string> = JSON_TYPE) =>
    new Request('http://localhost/api', { method: 'PUT', headers, body });

  it('parses JSON whatever the case of the media type or its parameters', async () => {
    // Arrange
    const types = ['application/json', 'Application/JSON', 'application/json; charset=utf-8', ' application/json ;x=1'];

    // Act
    const results = await Promise.all(types.map((type) => readJsonBody(request('{"a":[1]}', { 'content-type': type }))));

    // Assert
    for (const result of results) expect(result).toEqual({ ok: true, value: { a: [1] } });
  });

  it('answers 415 for other media types without touching the body', async () => {
    // Arrange：没给 Content-Type 时，字符串请求体默认是 text/plain
    const requests = [
      request('{}', {}),
      request('{}', { 'content-type': 'text/plain' }),
      request('{}', { 'content-type': 'application/jsonp' }),
      request('{}', { 'content-type': 'application/merge-patch+json' }),
    ];

    // Act
    const results = await Promise.all(requests.map((r) => readJsonBody(r)));

    // Assert
    for (const result of results) {
      expect(result).toEqual({ ok: false, status: 415, message: '请求体必须是 JSON（Content-Type: application/json）' });
    }
    for (const r of requests) expect(r.bodyUsed).toBe(false);
  });

  it('answers 413 when the body, streamed or declared, is larger than the limit', async () => {
    // Arrange：声明的 content-length 超限时不读流就拒绝
    const streamed = request('x'.repeat(MAX_BODY_BYTES + 1));
    const declared = { headers: new Headers({ ...JSON_TYPE, 'content-length': '5000' }), body: null };

    // Act
    const results = [
      await readJsonBody(streamed),
      await readJsonBody(declared),
      await readJsonBody(request('"abcd"'), 5),
    ];

    // Assert
    expect(results).toEqual([
      { ok: false, status: 413, message: '请求体太大（最多 4096 字节）' },
      { ok: false, status: 413, message: '请求体太大（最多 4096 字节）' },
      { ok: false, status: 413, message: '请求体太大（最多 5 字节）' },
    ]);
  });

  it('answers 400 when the body cannot be read, is missing, is not UTF-8 or is not JSON', async () => {
    // Arrange：连接中途断开时读流会抛错
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const requests = [
      { headers: new Headers(JSON_TYPE), body: broken },
      request(null),
      request(new Uint8Array([0x22, 0xff, 0x22])),
      request('{"a":'),
    ];

    // Act
    const results = await Promise.all(requests.map((r) => readJsonBody(r)));

    // Assert
    expect(results).toEqual([
      { ok: false, status: 400, message: '请求体读取失败' },
      { ok: false, status: 400, message: '请求体不是有效的 JSON' },
      { ok: false, status: 400, message: '请求体不是有效的 JSON' },
      { ok: false, status: 400, message: '请求体不是有效的 JSON' },
    ]);
  });
});
