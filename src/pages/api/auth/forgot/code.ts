import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok } from '../../../../core/api';
import { clientInfo, readBody, rejectInput } from '../../../../adapters/auth/http';
import { getRegistration } from '../../../../adapters/auth/signup';

/** POST /api/auth/forgot/code：给绑定的邮箱发重设密码的验证码；邮箱没注册也回「发了」 */
const Body = z.object({
  email: z.string({ error: '请填写邮箱' }),
  turnstile: z.string().default(''),
});

export const POST: APIRoute = async ({ request }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const body = await readBody(request, Body);
  if (!body.ok) return body.response;
  try {
    await (await getRegistration()).requestResetCode(body.data.email, body.data.turnstile, clientInfo(request));
    return json(200, ok(null));
  } catch (error) {
    return rejectInput(error);
  }
};
