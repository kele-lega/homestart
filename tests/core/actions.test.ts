import { z } from 'astro/zod';
import type { APIContext, APIRoute } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWidgetAction, type ActionDeps, type ActionRequest } from '../../src/core/actions';
import { readJsonBody } from '../../src/core/api';
import { UpstreamError } from '../../src/core/http';
import { resolveLayout } from '../../src/core/layout';
import { parseLinks } from '../../src/core/links';
import { loadConfig } from '../../src/core/runtime';
import { parseSite } from '../../src/core/site';
import { ActionInputError, defineWidget, type ActionContext, type AnyWidgetDefinition } from '../../src/core/widget';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../../src/lib/widget-api';
import { DELETE, GET, PUT } from '../../src/pages/api/widgets/[id]/[action]';

// 路由用例只用这里的 echo Widget：真实注册表会带上所有 Widget，和操作契约无关
const mocked = vi.hoisted(() => ({ registry: new Map<string, unknown>() }));
vi.mock('../../src/core/registry', () => ({ registry: mocked.registry }));
vi.mock('../../src/core/runtime', () => ({ loadConfig: vi.fn() }));

/** 记录每次执行收到的上下文 */
const seen = vi.fn<(ctx: ActionContext<unknown>) => void>();

const echo = defineWidget({
  type: 'echo',
  options: z.strictObject({ prefix: z.string().default('>') }),
  actions: {
    say: {
      query: z.object({ q: z.string().min(1) }),
      maxAge: 60,
      run: async (options, query: { q: string }, ctx) => {
        seen(ctx);
        return `${options.prefix}${query.q}`;
      },
    },
    plain: { query: z.object({}), run: async () => 'plain' },
    save: {
      method: 'PUT',
      query: z.object({ mode: z.enum(['merge', 'replace']).default('merge') }),
      body: z.strictObject({ url: z.string().trim().min(1) }),
      // PUT 不缓存：这里故意声明 maxAge，结果里也不能带出来
      maxAge: 60,
      run: async (options, query: { mode: string }, ctx: ActionContext<{ url: string }>) => {
        seen(ctx);
        return `${options.prefix}${query.mode}:${ctx.body.url}`;
      },
    },
    reset: {
      method: 'DELETE',
      query: z.object({}),
      run: async (options, _query: unknown, ctx) => {
        seen(ctx);
        return `${options.prefix}reset`;
      },
    },
    reject: { query: z.object({}), run: async () => Promise.reject(new ActionInputError('订阅地址填错了')) },
    upstream: { query: z.object({}), run: async () => Promise.reject(new UpstreamError('api.example 超时')) },
    crash: { query: z.object({}), run: async () => Promise.reject(new Error('secret detail')) },
    // 抛出的不是 Error：日志里要能看到原值
    throwString: { query: z.object({}), run: async () => Promise.reject('raw secret') },
    // 浏览器断开后，下游按请求的信号中止，抛出的是信号的原因
    cancelled: { query: z.object({}), run: async (_options, _query, ctx) => Promise.reject(ctx.signal.reason) },
  },
});

// 布局校验要查注册表，先登记 echo
mocked.registry.set('echo', echo);
const registry = mocked.registry as Map<string, AnyWidgetDefinition>;

const layout = resolveLayout(
  {
    widgets: [
      { id: 'echo1', type: 'echo', options: { prefix: '#' } },
      { id: 'broken', type: 'echo', options: { prefix: 5 } },
      { id: 'orphan', type: 'echo' },
    ],
    zones: [{ id: 'main', items: ['echo1', 'broken'] }],
    page: { desktop: { areas: ['main'], columns: '1fr' }, mobile: { order: ['echo1', 'broken'] } },
  },
  registry,
);
const config: ActionDeps['config'] = { site: parseSite({}), links: parseLinks({}), layout };

const JSON_TYPE = { 'content-type': 'application/json' };

beforeEach(() => {
  seen.mockClear();
  // 环境里残留的开发用户会让路由用例打出警告，这里统一去掉
  vi.stubEnv('HOME_DEV_USER', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Call {
  readonly method?: string;
  readonly params?: Record<string, string>;
  /** 原样作为请求体发送；不给就是没有请求体 */
  readonly body?: string;
  readonly headers?: Record<string, string>;
  /** 请求的取消信号；不给就是一直没取消 */
  readonly signal?: AbortSignal;
}

/** 带 application/json 的请求体 */
function jsonBody(value: unknown): Call {
  return { body: JSON.stringify(value), headers: JSON_TYPE };
}

function setup(allowed = true) {
  const allow = vi.fn((_user: string) => allowed);
  const logError = vi.fn<(message: string) => void>();
  const readBody = vi.fn((source: Request) => readJsonBody(source));
  const deps: ActionDeps = { config, registry, allow, logError };
  const run = (widgetId: string, action: string, call: Call = {}) => {
    // 和路由一样用 readJsonBody 读真实的 Request，415/413/400 走的是同一条路径
    const source = new Request('http://localhost/api', { method: 'PUT', headers: call.headers, body: call.body ?? null });
    const request: ActionRequest = {
      widgetId,
      action,
      method: call.method ?? 'GET',
      params: new URLSearchParams(call.params),
      user: 'alice',
      signal: call.signal ?? new AbortController().signal,
      readBody: () => readBody(source),
    };
    return runWidgetAction(request, deps);
  };
  return { run, allow, logError, readBody };
}

describe('runWidgetAction', () => {
  it('runs a GET action with parsed options and query, and passes user, signal and site', async () => {
    // Arrange
    const { run, readBody } = setup();

    // Act
    const result = await run('echo1', 'say', { params: { q: 'hi' } });

    // Assert
    expect(result).toEqual({ status: 200, body: { success: true, data: '#hi', error: null }, maxAge: 60 });
    expect(seen).toHaveBeenCalledExactlyOnceWith({
      user: 'alice',
      signal: expect.any(AbortSignal),
      site: config.site,
      body: undefined,
    });
    expect(readBody).not.toHaveBeenCalled();
  });

  it('treats HEAD as GET and matches methods case-insensitively', async () => {
    // Arrange
    const { run } = setup();

    // Act
    const results = await Promise.all(
      ['HEAD', 'head', 'get'].map((method) => run('echo1', 'say', { method, params: { q: 'hi' } })),
    );

    // Assert：HEAD 用的也是 GET 操作声明的 maxAge
    for (const result of results) expect(result).toMatchObject({ status: 200, maxAge: 60 });
  });

  it('answers 404 for unknown, unplaced or misconfigured widgets and unknown actions before checking the method', async () => {
    // Arrange
    const { run, allow, readBody } = setup();
    const cases = [
      ['nope', 'say'],
      ['orphan', 'say'],
      ['broken', 'say'],
      ['echo1', 'nope'],
      ['echo1', 'constructor'],
      ['echo1', '__proto__'],
    ] as const;

    // Act：PUT 也一样是 404，找不到操作就轮不到方法检查
    const results = await Promise.all(
      cases.flatMap(([id, action]) => ['GET', 'PUT'].map((method) => run(id, action, { method }))),
    );

    // Assert
    for (const result of results) {
      expect(result).toEqual({ status: 404, body: { success: false, data: null, error: '没有这个接口' } });
    }
    expect(allow).not.toHaveBeenCalled();
    expect(readBody).not.toHaveBeenCalled();
  });

  it('answers 405 with an Allow header before rate limiting or reading the body', async () => {
    // Arrange
    const { run, allow, readBody } = setup();
    const cases = [
      ['say', 'PUT', 'GET'],
      ['say', 'POST', 'GET'],
      ['save', 'GET', 'PUT'],
      ['save', 'HEAD', 'PUT'],
      ['save', 'DELETE', 'PUT'],
      ['reset', 'PUT', 'DELETE'],
    ] as const;

    // Act
    const results = await Promise.all(cases.map(([action, method]) => run('echo1', action, { method })));

    // Assert
    results.forEach((result, i) => {
      expect(result).toEqual({
        status: 405,
        body: { success: false, data: null, error: '不支持这个请求方法' },
        headers: { allow: cases[i]![2] },
      });
    });
    expect(allow).not.toHaveBeenCalled();
    expect(readBody).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
  });

  it('answers 429 before validating the query or reading the body', async () => {
    // Arrange
    const { run, allow, readBody } = setup(false);

    // Act：查询参数和请求体都不合法，也先被限流挡住
    const result = await run('echo1', 'save', { method: 'PUT', params: { mode: 'bogus' }, body: '{' });

    // Assert
    expect(result).toEqual({ status: 429, body: { success: false, data: null, error: '请求太频繁，请稍后再试' } });
    expect(allow).toHaveBeenCalledExactlyOnceWith('alice');
    expect(readBody).not.toHaveBeenCalled();
  });

  it('answers 400 with the validation problem for bad query parameters, without reading the body', async () => {
    // Arrange
    const { run, readBody } = setup();

    // Act
    const missing = await run('echo1', 'say');
    const wrongMode = await run('echo1', 'save', { method: 'PUT', params: { mode: 'bogus' }, ...jsonBody({ url: 'x' }) });

    // Assert
    expect(missing).toMatchObject({ status: 400, body: { success: false, data: null } });
    expect(missing.body.error).toMatch(/^q: /);
    expect(wrongMode.status).toBe(400);
    expect(wrongMode.body.error).toMatch(/^mode: /);
    expect(readBody).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
  });

  it('answers 415 when a body action gets no JSON content type', async () => {
    // Arrange
    const { run, readBody } = setup();
    const bodies: Call[] = [
      {},
      { body: '{"url":"x"}' },
      { body: '{"url":"x"}', headers: { 'content-type': 'text/plain' } },
      { body: 'url=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
    ];

    // Act
    const results = await Promise.all(bodies.map((call) => run('echo1', 'save', { method: 'PUT', ...call })));

    // Assert
    for (const result of results) {
      expect(result).toEqual({
        status: 415,
        body: { success: false, data: null, error: '请求体必须是 JSON（Content-Type: application/json）' },
      });
    }
    expect(readBody).toHaveBeenCalledTimes(bodies.length);
    expect(seen).not.toHaveBeenCalled();
  });

  it('answers 413 above 4096 bytes and accepts a body of exactly 4096 bytes', async () => {
    // Arrange：{"url":"..."} 的外壳占 10 字节
    const { run } = setup();
    const sized = (bytes: number): Call => ({ body: `{"url":"${'a'.repeat(bytes - 10)}"}`, headers: JSON_TYPE });

    // Act
    const fits = await run('echo1', 'save', { method: 'PUT', ...sized(4096) });
    const tooLarge = await run('echo1', 'save', { method: 'PUT', ...sized(4097) });

    // Assert
    expect(fits.status).toBe(200);
    expect(tooLarge).toEqual({ status: 413, body: { success: false, data: null, error: '请求体太大（最多 4096 字节）' } });
    expect(seen).toHaveBeenCalledOnce();
  });

  it('answers 400 when the body is not valid JSON', async () => {
    // Arrange
    const { run } = setup();
    const bodies = ['', '{', "{'url':'x'}", '{"url":"x"} trailing'];

    // Act
    const results = await Promise.all(
      bodies.map((body) => run('echo1', 'save', { method: 'PUT', body, headers: JSON_TYPE })),
    );

    // Assert
    for (const result of results) {
      expect(result).toEqual({ status: 400, body: { success: false, data: null, error: '请求体不是有效的 JSON' } });
    }
    expect(seen).not.toHaveBeenCalled();
  });

  it('answers 400 with the validation problem when the body does not match the schema', async () => {
    // Arrange
    const { run } = setup();
    const values: unknown[] = [{}, { url: '   ' }, { url: 'x', extra: 1 }, [], null, 'x'];

    // Act
    const results = await Promise.all(values.map((value) => run('echo1', 'save', { method: 'PUT', ...jsonBody(value) })));

    // Assert
    for (const result of results) {
      expect(result).toMatchObject({ status: 400, body: { success: false, data: null, error: expect.any(String) } });
    }
    expect(results[0]!.body.error).toMatch(/^url: /);
    expect(seen).not.toHaveBeenCalled();
  });

  it('passes the validated body to a PUT action together with user, site and the query, and never caches it', async () => {
    // Arrange
    const { run, readBody } = setup();
    const call: Call = { method: 'PUT', params: { mode: 'replace' }, ...jsonBody({ url: '  https://example.com/a.ics  ' }) };

    // Act
    const result = await run('echo1', 'save', call);

    // Assert：ctx.body 是 schema 处理后的值（去掉了空白），声明的 maxAge 对 PUT 不生效
    expect(result).toEqual({
      status: 200,
      body: { success: true, data: '#replace:https://example.com/a.ics', error: null },
      maxAge: undefined,
    });
    expect(seen).toHaveBeenCalledExactlyOnceWith({
      user: 'alice',
      signal: expect.any(AbortSignal),
      site: config.site,
      body: { url: 'https://example.com/a.ics' },
    });
    expect(readBody).toHaveBeenCalledOnce();
  });

  it('runs a DELETE action without reading a body', async () => {
    // Arrange
    const { run, readBody } = setup();

    // Act：带了请求体也不读，因为操作没有声明 body
    const result = await run('echo1', 'reset', { method: 'DELETE', ...jsonBody({ ignored: true }) });

    // Assert
    expect(result).toEqual({ status: 200, body: { success: true, data: '#reset', error: null }, maxAge: undefined });
    expect(seen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user: 'alice', body: undefined }));
    expect(readBody).not.toHaveBeenCalled();
  });

  it('answers 400 with the message of an ActionInputError and does not log it', async () => {
    // Arrange
    const { run, logError } = setup();

    // Act
    const result = await run('echo1', 'reject');

    // Assert
    expect(result).toEqual({ status: 400, body: { success: false, data: null, error: '订阅地址填错了' } });
    expect(logError).not.toHaveBeenCalled();
  });

  it('maps upstream failures to 502 and anything else to 500, logging details only on the server', async () => {
    // Arrange
    const { run, logError } = setup();

    // Act
    const upstream = await run('echo1', 'upstream');
    const crashed = await run('echo1', 'crash');
    const thrown = await run('echo1', 'throwString');

    // Assert：返回给前端的只有固定文案
    expect(upstream).toEqual({ status: 502, body: { success: false, data: null, error: '外部服务暂时不可用' } });
    expect(crashed).toEqual({ status: 500, body: { success: false, data: null, error: '服务器内部错误' } });
    expect(thrown).toEqual(crashed);
    expect(logError.mock.calls).toEqual([
      ['echo1/upstream 失败：api.example 超时'],
      ['echo1/crash 失败：secret detail'],
      ['echo1/throwString 失败：raw secret'],
    ]);
  });

  it('answers 499 without logging when the browser has already gone away', async () => {
    // Arrange
    const { run, logError } = setup();
    const controller = new AbortController();
    controller.abort();

    // Act：下游的错误可能直接是取消的原因，也可能被包成别的错误
    const cancelled = await run('echo1', 'cancelled', { signal: controller.signal });
    const wrapped = await run('echo1', 'upstream', { signal: controller.signal });

    // Assert
    expect(cancelled).toEqual({ status: 499, body: { success: false, data: null, error: '请求已取消' } });
    expect(wrapped).toEqual(cancelled);
    expect(logError).not.toHaveBeenCalled();
  });

  it('lets the browser cache only successful GET results of actions that declare maxAge', async () => {
    // Arrange
    const { run } = setup();

    // Act
    const declared = await run('echo1', 'say', { params: { q: 'hi' } });
    const undeclared = await run('echo1', 'plain');
    const failed = await run('echo1', 'say');

    // Assert
    expect(declared.maxAge).toBe(60);
    expect(undeclared).toEqual({ status: 200, body: { success: true, data: 'plain', error: null }, maxAge: undefined });
    expect(failed.status).toBe(400);
    expect(failed.maxAge).toBeUndefined();
  });
});

describe('route /api/widgets/[id]/[action]: same-origin guard and HTTP mapping', () => {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const handlers: Readonly<Record<string, APIRoute>> = { GET, PUT, DELETE };

  beforeEach(() => {
    vi.mocked(loadConfig).mockReset().mockResolvedValue(config);
  });

  /** 和 Astro 一样：按方法选导出的处理函数，id / action 取自路径 */
  async function call(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , , id, action] = url.pathname.split('/');
    const context = { params: { id, action }, request, url, logger, locals: {} };
    return handlers[request.method]!(context as unknown as APIContext);
  }

  const put = (headers: Record<string, string>) =>
    new Request('http://localhost/api/widgets/echo1/save', {
      method: 'PUT',
      headers,
      body: '{"url":"https://example.com/a.ics"}',
    });

  it('rejects cross-site writes with 403 before loading the config or reading the body', async () => {
    // Arrange：Sec-Fetch-Site 优先；没有它时要求只有同源脚本加得上的自定义头
    const requests = [
      put({ ...JSON_TYPE, 'sec-fetch-site': 'cross-site' }),
      put({ ...JSON_TYPE, 'sec-fetch-site': 'same-site' }),
      put({ ...JSON_TYPE, 'sec-fetch-site': 'none' }),
      put({ ...JSON_TYPE, 'sec-fetch-site': 'cross-site', [CLIENT_HEADER]: CLIENT_HEADER_VALUE }),
      put(JSON_TYPE),
    ];

    // Act
    const responses = await Promise.all(requests.map((request) => call(request)));

    // Assert
    for (const response of responses) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ success: false, data: null, error: '不允许跨站请求' });
    }
    for (const request of requests) expect(request.bodyUsed).toBe(false);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
  });

  it('runs a same-origin JSON PUT for the authenticated user and never caches the answer', async () => {
    // Arrange
    const viaFetchMetadata = put({ ...JSON_TYPE, 'sec-fetch-site': 'same-origin', 'x-authenticated-user': 'alice' });
    const viaClientHeader = put({ ...JSON_TYPE, [CLIENT_HEADER]: CLIENT_HEADER_VALUE, 'x-authenticated-user': 'bob' });

    // Act
    const first = await call(viaFetchMetadata);
    const second = await call(viaClientHeader);

    // Assert
    for (const response of [first, second]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual({ success: true, data: '#merge:https://example.com/a.ics', error: null });
    }
    expect(seen.mock.calls.map(([ctx]) => [ctx.user, ctx.body])).toEqual([
      ['alice', { url: 'https://example.com/a.ics' }],
      ['bob', { url: 'https://example.com/a.ics' }],
    ]);
  });

  it('answers 415 for a same-origin PUT without a JSON body', async () => {
    // Arrange
    const request = put({ 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' });

    // Act
    const response = await call(request);

    // Assert
    expect(response.status).toBe(415);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(seen).not.toHaveBeenCalled();
  });

  it('sends Allow on 405, caches successful GETs privately and runs DELETE', async () => {
    // Arrange
    const sameOrigin = { 'sec-fetch-site': 'same-origin' };
    const base = 'http://localhost/api/widgets/echo1';

    // Act
    const wrongMethod = await call(new Request(`${base}/save`, { headers: sameOrigin }));
    const cached = await call(new Request(`${base}/say?q=hi`, { headers: sameOrigin }));
    const deleted = await call(new Request(`${base}/reset`, { method: 'DELETE', headers: sameOrigin }));

    // Assert
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('PUT');
    expect(wrongMethod.headers.get('cache-control')).toBe('no-store');
    await expect(wrongMethod.json()).resolves.toEqual({ success: false, data: null, error: '不支持这个请求方法' });
    expect(cached.headers.get('cache-control')).toBe('private, max-age=60');
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get('cache-control')).toBe('no-store');
    await expect(deleted.json()).resolves.toEqual({ success: true, data: '#reset', error: null });
  });
});
