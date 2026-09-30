import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../../core/api';
import { formatIssues } from '../../../core/config-error';
import { createRateLimiter } from '../../../core/rate-limit';
import { getAuthService } from '../../../adapters/auth/service';
import { AuthInputError } from '../../../adapters/auth/store';
import { SESSION_COOKIE } from '../../../adapters/auth/session';

/**
 * POST /api/auth/login：账号密码校验，成功发 HttpOnly Cookie。
 * 按来源 IP 限流（登录前还没有用户身份），避免暴力猜密码
 */
const Body = z.object({ username: z.string({ error: '请填写用户名' }), password: z.string({ error: '请填写密码' }) });

// 正常人手输密码，几次内就该知道对不对；10 次/分钟够用又能挡暴力枚举
const allow = createRateLimiter({ limit: 10, windowMs: 60_000, maxKeys: 1000 });

function clientKey(request: Request): string {
  // 没有反代头时按连接本身处理；生产环境经 Caddy 转发，反代应在配置里转发真实来源 IP
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'direct';
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (!allow(clientKey(request))) return json(429, fail('尝试太频繁，请稍后再试'));

  const read = await readJsonBody(request);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = Body.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));

  const service = await getAuthService();
  try {
    const { sessionId, username, role } = await service.login(parsed.data.username, parsed.data.password);
    cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600,
    });
    return json(200, ok({ username, role }));
  } catch (error) {
    if (error instanceof AuthInputError) return json(400, fail(error.message));
    throw error;
  }
};
