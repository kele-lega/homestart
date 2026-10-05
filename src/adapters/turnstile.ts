/**
 * Cloudflare Turnstile 的服务端校验（https://developers.cloudflare.com/turnstile/get-started/server-side-validation/）。
 * 浏览器里的小部件给一个一次性令牌，这里拿密钥去换「是不是真人」的结论；令牌 5 分钟内有效、只能校验一次
 */
import { fetchJson } from '../core/http';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** 通过返回 true；令牌无效、过期、用过返回 false；Cloudflare 那边出问题时抛 UpstreamError */
export type HumanCheck = (token: string, ip: string | null) => Promise<boolean>;

export function createTurnstileCheck(secretKey: string, doFetch?: typeof fetch): HumanCheck {
  return async (token, ip) => {
    if (!token || token.length > 2048) return false;
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (ip) body.set('remoteip', ip);
    const result = (await fetchJson(SITEVERIFY_URL, {
      method: 'POST',
      timeoutMs: 8_000,
      maxBytes: 8_192,
      body,
      fetch: doFetch,
    })) as { success?: unknown } | null;
    return result?.success === true;
  };
}
