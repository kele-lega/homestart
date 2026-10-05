/**
 * 建议：登录用户在首页「本站」版块里提交，只有管理员能看、标记处理、删除。
 * 这里是服务端和浏览器都要用的形状和上限；校验在 core/suggestions，存储在 adapters/suggestions。
 * 这个模块会进浏览器，不能引用服务端代码
 */
import { jsonHeaders } from './widget-api';

export const SUGGESTION_LIMITS = {
  body: 500,
  /** 最多留多少条：再提交新的，最旧的那条被挤掉 */
  count: 500,
} as const;

export interface Suggestion {
  readonly id: string;
  /** 纯文本，按原样换行显示，不解析任何标记 */
  readonly body: string;
  /** 提交时的用户名，和昵称（没有就是用户名），之后改名不跟着变 */
  readonly username: string;
  readonly author: string;
  readonly createdAt: number;
  /** 管理员标成已处理 */
  readonly done: boolean;
}

export const SUGGESTIONS_URL = '/api/suggestions';

export function pendingCount(list: readonly Suggestion[]): number {
  return list.filter((item) => !item.done).length;
}

type Envelope = { success?: unknown; data?: unknown; error?: unknown };

async function send(path: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, {
      method,
      headers: jsonHeaders(method),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json()) as Envelope;
    if (envelope.success === true) return { ok: true, data: envelope.data };
    return { ok: false, message: typeof envelope.error === 'string' && envelope.error ? envelope.error : '操作失败，请稍后再试' };
  } catch {
    return { ok: false, message: '网络出了点问题，请稍后再试' };
  }
}

export type SuggestionsResult =
  | { readonly ok: true; readonly list: readonly Suggestion[] }
  | { readonly ok: false; readonly message: string };

/** 管理员的操作：成功时都带回整个列表 */
async function manage(path: string, method: string, body?: unknown): Promise<SuggestionsResult> {
  const result = await send(path, method, body);
  if (!result.ok) return result;
  return Array.isArray(result.data) ? { ok: true, list: result.data as Suggestion[] } : { ok: false, message: '操作失败，请稍后再试' };
}

const itemUrl = (id: string) => `${SUGGESTIONS_URL}/${encodeURIComponent(id)}`;

export interface Captcha {
  readonly id: string;
  /** data: 地址，放进 <img src> */
  readonly image: string;
}

/** 领一道验证码：每次都是新的一题，答过一次（不管对错）就作废 */
export async function fetchCaptcha(): Promise<{ readonly ok: true; readonly captcha: Captcha } | { readonly ok: false; readonly message: string }> {
  const result = await send(`${SUGGESTIONS_URL}/captcha`, 'GET');
  if (!result.ok) return result;
  const data = result.data as Partial<Captcha> | null;
  return typeof data?.id === 'string' && typeof data.image === 'string' && data.image.startsWith('data:image/svg+xml')
    ? { ok: true, captcha: { id: data.id, image: data.image } }
    : { ok: false, message: '验证码没取到，请稍后再试' };
}

export async function submitSuggestion(
  body: string,
  captchaId: string,
  captcha: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const result = await send(SUGGESTIONS_URL, 'POST', { body, captchaId, captcha });
  return result.ok ? { ok: true } : result;
}

export const fetchSuggestions = () => manage(SUGGESTIONS_URL, 'GET');

export const markSuggestion = (id: string, done: boolean) => manage(itemUrl(id), 'PATCH', { done });

export const removeSuggestion = (id: string) => manage(itemUrl(id), 'DELETE');
