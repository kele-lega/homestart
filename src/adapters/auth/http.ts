/**
 * 登录相关路由共用的 HTTP 细节：来源 IP、会话 Cookie、登录限流、「登录一次」的完整流程。
 * /api/auth/login（脚本登录）和 /login 页面（没等到脚本时的表单直接提交）走的是同一个 attemptLogin。
 */
import type { AstroCookies } from 'astro';
import { isIP } from 'node:net';
import { fail, json } from '../../core/api';
import { createRateLimiter } from '../../core/rate-limit';
import { getAuthService, type LoginResult } from './service';
import { REMEMBER_TTL_MS, SESSION_COOKIE } from './session';
import { AuthInputError } from './store';

/**
 * 反代转发的真实来源 IP（X-Forwarded-For 第一段）。生产环境只经 Caddy 访问，Caddy 默认不信任客户端带来的这个头、
 * 自己重写；直连开发服务器时没有这个头。不是合法 IP 的值一律不记
 */
export function clientIp(headers: Headers): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  return isIP(first) ? first : null;
}

/** 勾了「记住我」写 30 天的 Max-Age；没勾是会话 Cookie，关掉浏览器就没了 */
export function setSessionCookie(cookies: AstroCookies, token: string, remember: boolean): void {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: REMEMBER_TTL_MS / 1000 } : {}),
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** 业务规则拒绝（AuthInputError）→ 400 和中文说明；其它异常照常抛出 */
export function rejectInput(error: unknown): Response {
  if (error instanceof AuthInputError) return json(400, fail(error.message));
  throw error;
}

/** 个人中心的写操作按登录用户限流；改密码要跑 scrypt，单独一档更紧的 */
export const allowAccountWrite = createRateLimiter({ limit: 30, windowMs: 60_000, maxKeys: 1000 });
export const allowPasswordChange = createRateLimiter({ limit: 10, windowMs: 60_000, maxKeys: 1000 });

// 正常人手输密码，几次内就该知道对不对；10 次/分钟够用又能挡暴力枚举。登录前还没有用户身份，按来源 IP 计数。
// e2e 的所有用例都从同一个地址登录，用环境变量单独放宽（同 WIDGET_ACTION_RATE_LIMIT），不改变生产环境的默认值
const configuredLoginLimit = Number(process.env.AUTH_LOGIN_RATE_LIMIT);
const allowLogin = createRateLimiter({
  limit: Number.isFinite(configuredLoginLimit) && configuredLoginLimit > 0 ? configuredLoginLimit : 10,
  windowMs: 60_000,
  maxKeys: 1000,
});

export interface LoginAttempt {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
}

export type LoginOutcome =
  | { readonly ok: true; readonly result: LoginResult }
  | { readonly ok: false; readonly status: 400 | 429; readonly message: string };

/** 限流 → 校验 → 成功时写 Cookie。账号密码不对是 400，太频繁是 429；其它异常照常抛出 */
export async function attemptLogin(request: Request, cookies: AstroCookies, attempt: LoginAttempt): Promise<LoginOutcome> {
  const ip = clientIp(request.headers);
  if (!allowLogin(ip ?? 'direct')) return { ok: false, status: 429, message: '尝试太频繁，请稍后再试' };
  const service = await getAuthService();
  try {
    const result = await service.login({ ...attempt, userAgent: request.headers.get('user-agent'), ip });
    setSessionCookie(cookies, result.token, result.remember);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof AuthInputError) return { ok: false, status: 400, message: error.message };
    throw error;
  }
}
