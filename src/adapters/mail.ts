/**
 * 发信：走 Resend 的 HTTP 接口（https://resend.com/docs/api-reference/emails/send-email），纯文本，不引新依赖。
 * 只有注册、找回密码、改邮箱的验证码会发信；发件域名要先在 Resend 验证（DNS 记录见 docs/AUTH.md）
 */
import { decode, readUpTo, UpstreamError } from '../core/http';
import type { MailConfig } from './auth/config';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** 发不出去时抛 UpstreamError */
export type Mailer = (message: MailMessage) => Promise<void>;

const RESEND_URL = 'https://api.resend.com/emails';
const MAX_REPLY_BYTES = 16_384;

/** Resend 出错时回 `{ name, message }`，比如域名没验证；带进错误里，日志才看得出是哪种原因 */
async function reason(response: Response): Promise<string> {
  const bytes = await readUpTo(response, MAX_REPLY_BYTES).catch(() => undefined);
  if (!bytes) return '';
  try {
    const { name, message } = JSON.parse(decode(bytes, response.headers.get('content-type'))) as Record<string, unknown>;
    const parts = [name, message].filter((part): part is string => typeof part === 'string' && part !== '');
    return parts.length > 0 ? `：${parts.join(' - ').slice(0, 300)}` : '';
  } catch {
    return '';
  }
}

export function createResendMailer(config: MailConfig, doFetch: typeof fetch = fetch): Mailer {
  return async ({ to, subject, text }) => {
    let response: Response;
    try {
      response = await doFetch(RESEND_URL, {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: config.from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new UpstreamError(`api.resend.com：${timedOut ? '请求超时' : error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new UpstreamError(`api.resend.com 返回 HTTP ${response.status}${await reason(response)}`, response.status);
    }
    await response.body?.cancel().catch(() => undefined);
  };
}
