import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../lib/widget-api';
import { readUpTo } from './http';

/**
 * /api 路由共用的约定：统一的 { success, data, error } 响应、登录用户识别、跨站请求拦截。
 * 不返回任何 CORS 头，其它站点的脚本读不到这些接口。
 */

export interface ApiEnvelope<T = unknown> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
}

export function ok<T>(data: T): ApiEnvelope<T> {
  return { success: true, data, error: null };
}

export function fail(error: string): ApiEnvelope<never> {
  return { success: false, data: null, error };
}

/** 统一的 JSON 响应；成功且 maxAge > 0 时允许浏览器私有缓存。headers 用来附加 Allow 之类，不能覆盖下面几个固定的头 */
export function json(status: number, body: ApiEnvelope, maxAge = 0, headers: Readonly<Record<string, string>> = {}): Response {
  const cache = status === 200 && maxAge > 0 ? `private, max-age=${maxAge}` : 'no-store';
  // 用 set 覆盖：对象展开分不清大小写，'Content-Type' 会和固定的头并存、被合并成两个值
  const merged = new Headers(headers);
  merged.set('content-type', 'application/json; charset=utf-8');
  merged.set('cache-control', cache);
  merged.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: merged });
}

/** Caddy basic_auth 通过后注入的用户名；直连开发服务器时没有这个头 */
const USER_HEADER = 'x-authenticated-user';
export const USER_NAME = /^[\w.@-]{1,64}$/;
/** 没带或带了无效用户名时的身份；带括号，不可能和真实用户名撞上 */
export const ANONYMOUS = '(anonymous)';

/**
 * 本地开发直连开发服务器时没有身份头：设置 HOME_DEV_USER=<用户名> 就按这个用户处理，第一次用到时警告一次。
 * 生产环境绝不能设置——请求都经过 Caddy，头总是存在；设置了，绕过 Caddy 直连的请求就会被当成这个用户。
 * 头存在但无效（空白、非法字符）时照样是匿名，不会落到开发用户上。
 */
const DEV_USER_ENV = 'HOME_DEV_USER';
let devUserWarned = false;

function devUser(env: NodeJS.ProcessEnv): string | undefined {
  const user = env[DEV_USER_ENV]?.trim() ?? '';
  if (!USER_NAME.test(user)) return undefined;
  if (!devUserWarned) {
    devUserWarned = true;
    // 有意的服务端警告，不是调试语句
    console.warn(`[api] 请求没有 ${USER_HEADER} 头，按 ${DEV_USER_ENV}=${user} 处理；只用于本地开发，生产环境不要设置`);
  }
  return user;
}

/**
 * 站内登录（中间件解析 Cookie 后放进 locals.auth）优先；没有登录会话时退回反代注入的头或本地开发用户。
 * 两套是独立机制：登录是可选的个人身份，不登录时网站按原来的方式继续可用。
 */
export function userFrom(
  headers: Headers,
  auth?: { readonly username: string } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (auth) return auth.username;
  const header = headers.get(USER_HEADER);
  if (header === null) return devUser(env) ?? ANONYMOUS;
  const user = header.trim();
  return USER_NAME.test(user) ? user : ANONYMOUS;
}

/**
 * 浏览器会给请求带 Sec-Fetch-Site：接口只给本站页面脚本调用，只放行 same-origin。
 * 其它站点即使借用已缓存的 Basic Auth 凭据发请求，也会被标成 cross-site / same-site；
 * 地址栏、书签或其它应用里点开的链接是 none，页面脚本从不发出这种请求，一并拒绝。
 * 纯 HTTP 访问（非 localhost）和旧版 Safari 不带这个头，这时要求只有同源脚本才加得上的自定义头，
 * 其它站点的 <img>、表单和脚本都带不上；curl 调试时需要手动加上 `-H 'x-home-client: 1'`。
 */
export function isCrossSite(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null) return site !== 'same-origin';
  return headers.get(CLIENT_HEADER) !== CLIENT_HEADER_VALUE;
}

const FETCH_SITES = new Set(['cross-site', 'same-site', 'same-origin', 'none']);

/** 写进日志用的 Sec-Fetch-Site：只认规范里的四个值，其它一律不原样回显，伪造的头写不进日志 */
export function fetchSiteLabel(headers: Headers): string {
  const site = headers.get('sec-fetch-site');
  if (site === null) return '(missing)';
  return FETCH_SITES.has(site) ? site : '(invalid)';
}

/** 操作的请求体上限：只用来传设置（订阅地址等），4 KB 足够 */
export const MAX_BODY_BYTES = 4096;

export type BodyRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 400 | 413 | 415; readonly message: string };

function bodyError(status: 400 | 413 | 415, message: string): BodyRead {
  return { ok: false, status, message };
}

/** 读 JSON 请求体：必须是 application/json、不超过 maxBytes、UTF-8、能解析 */
export async function readJsonBody(request: Pick<Request, 'headers' | 'body'>, maxBytes = MAX_BODY_BYTES): Promise<BodyRead> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') return bodyError(415, '请求体必须是 JSON（Content-Type: application/json）');
  let bytes: Uint8Array | undefined;
  try {
    bytes = await readUpTo(request, maxBytes);
  } catch {
    return bodyError(400, '请求体读取失败');
  }
  if (!bytes) return bodyError(413, `请求体太大（最多 ${maxBytes} 字节）`);
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return bodyError(400, '请求体不是有效的 JSON');
  }
}
