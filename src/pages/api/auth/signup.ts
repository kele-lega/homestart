import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok } from '../../../core/api';
import { clientInfo, readBody, rejectInput, setSessionCookie } from '../../../adapters/auth/http';
import { getRegistration } from '../../../adapters/auth/signup';

/** POST /api/auth/signup：邮箱验证码对了就建号并直接登录（发会话 Cookie） */
const Body = z.object({
  email: z.string({ error: '请填写邮箱' }),
  code: z.string({ error: '请填写验证码' }),
  username: z.string({ error: '请填写用户名' }),
  password: z.string({ error: '请填写密码' }),
  remember: z.boolean({ error: 'remember 必须是 true 或 false' }).default(false),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const body = await readBody(request, Body);
  if (!body.ok) return body.response;
  try {
    const result = await (await getRegistration()).completeSignup(body.data, clientInfo(request));
    setSessionCookie(cookies, result.token, result.remember);
    const { username, displayName, role } = result.user;
    return json(200, ok({ username, displayName, role }));
  } catch (error) {
    return rejectInput(error);
  }
};
