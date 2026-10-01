import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../../core/api';
import { formatIssues } from '../../../core/config-error';
import { attemptLogin } from '../../../adapters/auth/http';

/**
 * POST /api/auth/login：账号密码校验，成功发 HttpOnly Cookie。
 * remember 为 true 时 Cookie 保留 30 天，否则关掉浏览器就失效。按来源 IP 限流，见 adapters/auth/http.ts
 */
const Body = z.object({
  username: z.string({ error: '请填写用户名' }),
  password: z.string({ error: '请填写密码' }),
  remember: z.boolean({ error: 'remember 必须是 true 或 false' }).default(false),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));

  const read = await readJsonBody(request);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = Body.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));

  const outcome = await attemptLogin(request, cookies, parsed.data);
  if (!outcome.ok) return json(outcome.status, fail(outcome.message));
  const { username, displayName, role } = outcome.result.user;
  return json(200, ok({ username, displayName, role }));
};
