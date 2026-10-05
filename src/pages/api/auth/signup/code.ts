import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok } from '../../../../core/api';
import { clientInfo, readBody, rejectInput } from '../../../../adapters/auth/http';
import { getRegistration } from '../../../../adapters/auth/signup';

/**
 * POST /api/auth/signup/code：给要注册的邮箱发验证码（先过人机验证）。
 * 邮箱已经注册过时改发一封提醒信，响应和正常发码一样
 */
const Body = z.object({
  email: z.string({ error: '请填写邮箱' }),
  turnstile: z.string().default(''),
});

export const POST: APIRoute = async ({ request }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const body = await readBody(request, Body);
  if (!body.ok) return body.response;
  try {
    await (await getRegistration()).requestSignupCode(body.data.email, body.data.turnstile, clientInfo(request));
    return json(200, ok(null));
  } catch (error) {
    return rejectInput(error);
  }
};
