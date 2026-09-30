/**
 * 下载 ICS 订阅：固定 UA 和 Accept、10 秒超时、5 MiB 上限，
 * 重定向手动跟随（最多 3 次），每一跳都重新过 url-guard，降级到 http:// 的一律拒绝。
 * 复用 http.ts 的读取工具：导入它也就带上了进程级的 TLS 设置。
 *
 * 私密订阅地址本身就是访问凭据：错误对象和日志里只出现主机名，
 * 路径、查询串和重定向目标都不记录。
 * 代理只走 Node 自带的环境变量支持（NODE_USE_ENV_PROXY=1 + HTTPS_PROXY），这里没有代理代码；
 * 开代理时 url-guard 的 DNS 检查仍在本机进行。
 */
import { decode, discard, readUpTo, UpstreamError } from '../../core/http';
import { checkUrl, type LookupFn } from './url-guard';

export type CalendarFetchReason =
  | 'invalid-url'
  | 'blocked'
  | 'dns'
  | 'timeout'
  | 'status'
  | 'not-ics'
  | 'too-large'
  | 'redirects'
  | 'network';

export class CalendarFetchError extends UpstreamError {
  constructor(
    message: string,
    readonly reason: CalendarFetchReason,
    /** 只有主机名（可带端口），可以写进日志 */
    readonly host: string,
    status?: number,
    /** 网络错误码（ECONNRESET 等），可以写进日志 */
    readonly detail?: string,
  ) {
    super(message, status);
    this.name = 'CalendarFetchError';
  }
}

export interface FetchIcsOptions {
  /** 测试时注入 */
  readonly fetch?: typeof fetch;
  readonly lookup?: LookupFn;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

// 有些日历服务按 UA 拦截脚本，用常见浏览器的 UA
export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
export const ACCEPT = 'text/calendar, text/plain;q=0.9, */*;q=0.1';
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_ICS_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// 登录页、错误页也可能是 200：内容必须真的是日历。\s 已包含 BOM（U+FEFF）
const ICS_START = /^\s*BEGIN:VCALENDAR/i;
const MIB = 1024 * 1024;

function statusMessage(status: number): string {
  if (status === 404 || status === 410) return '订阅地址已失效，请重新复制私密地址';
  if (status === 401 || status === 403) return '日历服务器拒绝访问，请确认用的是私密地址';
  if (status === 429) return '请求太频繁，日历服务器暂时拒绝';
  return `日历服务器返回 HTTP ${status}`;
}

function tooLargeMessage(maxBytes: number): string {
  return maxBytes >= MIB ? `日历文件超过 ${Math.floor(maxBytes / MIB)} MB` : `日历文件超过 ${maxBytes} 字节`;
}

function hostOf(url: string | URL): string {
  try {
    return new URL(url).host;
  } catch {
    return '(无效地址)';
  }
}

/** 网络错误码可以写进日志；错误消息里可能带着地址，不用 */
function errorCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  const code = cause?.code ?? (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : undefined;
}

async function guard(url: string, signal: AbortSignal, lookup: LookupFn | undefined): Promise<URL> {
  const check = await checkUrl(url, { signal, lookup });
  if (check.ok) return check.url;
  throw new CalendarFetchError(check.message, check.reason === 'invalid' ? 'invalid-url' : check.reason, hostOf(url));
}

function nextLocation(response: Response, base: URL): string {
  const location = response.headers.get('location');
  let next: URL | undefined;
  try {
    if (location) next = new URL(location, base);
  } catch {
    // 下面统一报错
  }
  if (!next) throw new CalendarFetchError('日历服务器的重定向地址无效', 'redirects', base.host);
  // url-guard 反正会拦，这里单独报一次，说清楚是服务器要降级
  if (next.protocol === 'http:') {
    throw new CalendarFetchError('日历服务器要求改用不加密的 http://，已拒绝', 'redirects', base.host);
  }
  return next.href;
}

async function readCalendar(response: Response, host: string, maxBytes: number): Promise<string> {
  if (!response.ok) {
    discard(response);
    throw new CalendarFetchError(statusMessage(response.status), 'status', host, response.status);
  }
  const bytes = await readUpTo(response, maxBytes);
  if (!bytes) throw new CalendarFetchError(tooLargeMessage(maxBytes), 'too-large', host);
  // 去掉 BOM 和开头的空白，解析器只看到日历本身
  const text = decode(bytes, response.headers.get('content-type')).replace(/^\s+/, '');
  if (!ICS_START.test(text)) throw new CalendarFetchError('这个地址返回的不是日历（ICS）文件', 'not-ics', host);
  return text;
}

/** 取回 ICS 文本；失败抛 CalendarFetchError，调用方的 signal 触发时抛它的 reason */
export async function fetchIcs(url: string, options: FetchIcsOptions = {}): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_ICS_BYTES;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      const target = await guard(current, signal, options.lookup);
      const response = await doFetch(target.href, {
        headers: { 'user-agent': USER_AGENT, accept: ACCEPT },
        signal,
        // 自己跟随，每一跳都重新检查目标地址
        redirect: 'manual',
      });
      if (!REDIRECT_STATUSES.has(response.status)) return await readCalendar(response, target.host, maxBytes);
      discard(response);
      if (hop >= MAX_REDIRECTS) throw new CalendarFetchError('重定向次数过多', 'redirects', target.host);
      current = nextLocation(response, target);
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (error instanceof CalendarFetchError) throw error;
    const host = hostOf(current);
    if (timeout.aborted) throw new CalendarFetchError('日历服务器响应超时', 'timeout', host);
    throw new CalendarFetchError('无法连接日历服务器', 'network', host, undefined, errorCode(error));
  }
}
