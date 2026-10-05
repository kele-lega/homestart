import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok } from '../../../core/api';
import { clientInfo, readBody, rejectInput, setSessionCookie } from '../../../adapters/auth/http';
import { getRegistration } from '../../../adapters/auth/signup';

/** POST /api/auth/forgot：验证码对了就换新密码，所有设备退出，当前这台重新登录 */
const Body = z.object({
  email: z.string({ error: '请填写邮箱' }),
  code: z.string({ error: '请填写验证码' }),
  password: z.string({ error: '请填写新密码' }),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const body = await readBody(request, Body);
  if (!body.ok) return body.response;
  try {
    const { email, code, password } = body.data;
    const result = await (await getRegistration()).completeReset(email, code, password, clientInfo(request));
    setSessionCookie(cookies, result.token, result.remember);
    const { username, displayName, role } = result.user;
    return json(200, ok({ username, displayName, role }));
  } catch (error) {
    return rejectInput(error);
  }
};
