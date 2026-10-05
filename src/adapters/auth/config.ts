/**
 * 注册、第三方登录要用的外部服务配置，全部从环境变量读（说明见 docs/AUTH.md、.env.example）。
 * 没配齐的功能直接不开：页面上不显示对应的按钮，接口回 503，其它登录方式照常可用。
 */
import type { Provider } from './identities';

export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface MailConfig {
  readonly apiKey: string;
  /** 发件人，如 `homestart <noreply@example.org>`；域名要先在 Resend 验证过 */
  readonly from: string;
}

export interface AuthConfig {
  /** 本站对外的地址（不带结尾斜杠），拼第三方登录的回调地址；没配就不开第三方登录 */
  readonly siteOrigin: string | null;
  readonly oauth: Readonly<Partial<Record<Provider, OAuthClient>>>;
  /** 没配就不能邮箱注册、找回密码、改邮箱 */
  readonly mail: MailConfig | null;
  /** Cloudflare Turnstile；没配就跳过人机验证，只靠按 IP 限流 */
  readonly turnstile: { readonly siteKey: string; readonly secretKey: string } | null;
  /** 全站每天最多新注册几个账号（邮箱注册和第三方登录自动建号合计） */
  readonly dailySignupLimit: number;
  /** 全站每天最多发几封信：Resend 免费额度是每天 100 封 */
  readonly dailyMailLimit: number;
}

const DEFAULT_DAILY_SIGNUP_LIMIT = 50;
const DEFAULT_DAILY_MAIL_LIMIT = 90;

const text = (env: NodeJS.ProcessEnv, name: string) => env[name]?.trim() || null;

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function origin(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.origin : null;
  } catch {
    return null;
  }
}

function client(env: NodeJS.ProcessEnv, prefix: string): OAuthClient | undefined {
  const clientId = text(env, `${prefix}_CLIENT_ID`);
  const clientSecret = text(env, `${prefix}_CLIENT_SECRET`);
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const siteOrigin = origin(text(env, 'SITE_ORIGIN'));
  const github = client(env, 'GITHUB');
  const google = client(env, 'GOOGLE');
  const apiKey = text(env, 'RESEND_API_KEY');
  const from = text(env, 'MAIL_FROM');
  const siteKey = text(env, 'TURNSTILE_SITE_KEY');
  const secretKey = text(env, 'TURNSTILE_SECRET_KEY');
  return {
    siteOrigin,
    oauth: siteOrigin ? { ...(github && { github }), ...(google && { google }) } : {},
    mail: apiKey && from ? { apiKey, from } : null,
    turnstile: siteKey && secretKey ? { siteKey, secretKey } : null,
    dailySignupLimit: positiveInt(env, 'SIGNUP_DAILY_LIMIT', DEFAULT_DAILY_SIGNUP_LIMIT),
    dailyMailLimit: positiveInt(env, 'MAIL_DAILY_LIMIT', DEFAULT_DAILY_MAIL_LIMIT),
  };
}
