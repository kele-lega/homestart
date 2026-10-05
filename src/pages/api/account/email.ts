import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok } from '../../../core/api';
import { readBody, rejectInput } from '../../../adapters/auth/http';
import { getRegistration } from '../../../adapters/auth/signup';

/** PUT /api/account/email：带着发到新邮箱的验证码，绑定（或换绑）邮箱 */
const Body = z.object({
  email: z.string({ error: '请填写邮箱' }),
  code: z.string({ error: '请填写验证码' }),
});

export const PUT: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  const body = await readBody(request, Body);
  if (!body.ok) return body.response;
  try {
    const email = (await getRegistration()).changeEmail(auth.userId, body.data.email, body.data.code);
    return json(200, ok({ email }));
  } catch (error) {
    return rejectInput(error);
  }
};
