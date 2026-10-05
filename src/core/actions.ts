import type { z } from 'astro/zod';
import { fail, ok, type ApiEnvelope, type BodyRead } from './api';
import type { AppConfig } from './config';
import { formatIssues } from './config-error';
import { UpstreamError } from './http';
import { findWidget, type Registry } from './layout';
import type { RateLimiter } from './rate-limit';
import { ActionInputError, type ActionMethod } from './widget';

/**
 * 执行 Widget 操作（/api/widgets/<id>/<action>）。与 HTTP 无关，便于单独测试；
 * 路由只负责读请求、把结果转换成 Response。
 * 检查顺序：404 → 405 → 429 → 查询参数 400 → 请求体 415/413/400 → 执行（输入错误 400 / 外部服务 502 / 其他 500）。
 * 浏览器中途断开时返回 499，不记日志。
 */

export interface ActionRequest {
  readonly widgetId: string;
  readonly action: string;
  /** HTTP 方法；HEAD 按 GET 处理 */
  readonly method: string;
  readonly params: URLSearchParams;
  readonly user: string;
  readonly signal: AbortSignal;
  /** 读取并解析 JSON 请求体；只有声明了 body 的操作才会调用，且只调用一次 */
  readonly readBody: () => Promise<BodyRead>;
}

export interface ActionDeps {
  readonly config: AppConfig;
  readonly registry: Registry;
  readonly allow: RateLimiter;
  /** 服务端日志；返回给前端的错误信息不含内部细节 */
  readonly logError: (message: string) => void;
}

export interface ActionResult {
  readonly status: number;
  readonly body: ApiEnvelope;
  readonly maxAge?: number;
  /** 附加的响应头，例如 405 的 Allow */
  readonly headers?: Readonly<Record<string, string>>;
}

/** 一步检查的结果：通过则带上校验后的值，否则是要直接返回的错误 */
type Step<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly result: ActionResult };

const NOT_FOUND: ActionResult = { status: 404, body: fail('没有这个接口') };

function findAction(request: ActionRequest, deps: ActionDeps) {
  const widget = findWidget(deps.config.layout, request.widgetId);
  if (!widget || widget.error) return undefined;
  const actions = deps.registry.get(widget.type)?.actions;
  // hasOwn 避免 constructor / __proto__ 之类的名字命中原型链
  if (!actions || !Object.hasOwn(actions, request.action)) return undefined;
  return { widget, action: actions[request.action]! };
}

function methodMatches(request: ActionRequest, expected: ActionMethod): boolean {
  const method = request.method.toUpperCase();
  return method === expected || (method === 'HEAD' && expected === 'GET');
}

function invalid(issues: Parameters<typeof formatIssues>[0]): ActionResult {
  return { status: 400, body: fail(formatIssues(issues).join('；')) };
}

/** 没有声明 body 的操作不读请求体，得到 undefined */
async function readBody(request: ActionRequest, schema: z.ZodType<unknown> | undefined): Promise<Step<unknown>> {
  if (!schema) return { ok: true, value: undefined };
  const read = await request.readBody();
  if (!read.ok) return { ok: false, result: { status: read.status, body: fail(read.message) } };
  const parsed = schema.safeParse(read.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, result: invalid(parsed.error.issues) };
}

/** 浏览器已经断开（翻页取消了旧请求、关了页面）：没人读这个响应，状态码沿用 nginx 的 499 */
const CLIENT_CLOSED: ActionResult = { status: 499, body: fail('请求已取消') };

function failure(error: unknown, label: string, signal: AbortSignal, deps: ActionDeps): ActionResult {
  // 浏览器断开后下游抛出的可能是取消原因本身，也可能被包成了别的错误；都不是服务端故障，不记日志
  if (signal.aborted) return CLIENT_CLOSED;
  // 输入错误的消息本来就是给用户看的，也不算服务端故障，不记日志
  if (error instanceof ActionInputError) return { status: 400, body: fail(error.message) };
  deps.logError(`${label} 失败：${error instanceof Error ? error.message : String(error)}`);
  return error instanceof UpstreamError
    ? { status: 502, body: fail('外部服务暂时不可用') }
    : { status: 500, body: fail('服务器内部错误') };
}

export async function runWidgetAction(request: ActionRequest, deps: ActionDeps): Promise<ActionResult> {
  const found = findAction(request, deps);
  if (!found) return NOT_FOUND;
  const { widget, action } = found;
  const method = action.method ?? 'GET';
  if (!methodMatches(request, method)) return { status: 405, body: fail('不支持这个请求方法'), headers: { allow: method } };
  if (!deps.allow(request.user)) return { status: 429, body: fail('请求太频繁，请稍后再试') };

  const query = action.query.safeParse(Object.fromEntries(request.params));
  if (!query.success) return invalid(query.error.issues);
  const body = await readBody(request, action.body);
  if (!body.ok) return body.result;

  try {
    const ctx = { user: request.user, signal: request.signal, site: deps.config.site, body: body.value };
    const data = await action.run(widget.options, query.data, ctx);
    // 浏览器只缓存 GET
    return { status: 200, body: ok(data), maxAge: method === 'GET' ? action.maxAge : undefined };
  } catch (error) {
    return failure(error, `${request.widgetId}/${request.action}`, request.signal, deps);
  }
}
