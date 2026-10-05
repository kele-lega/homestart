import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok } from '../../../../core/api';
import { readBody, rejectInput } from '../../../../adapters/auth/http';
import { getRegistration } from '../../../../adapters/auth/signup';

/** POST /api/account/email/code：给要绑定的新邮箱发验证码 */
const Body = z.object({ email: z.string({ error: '请填写邮箱' }) });

export const POST: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  const body = await readBody(request, Body);
  if (!body.ok) return body.response;
  try {
    await (await getRegistration()).requestEmailCode(auth.userId, body.data.email);
    return json(200, ok(null));
  } catch (error) {
    return rejectInput(error);
  }
};
