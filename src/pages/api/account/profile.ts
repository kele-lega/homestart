import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../../core/api';
import { formatIssues } from '../../../core/config-error';
import { allowAccountWrite, rejectInput } from '../../../adapters/auth/http';
import { getAuthService } from '../../../adapters/auth/service';

/** PATCH /api/account/profile：改自己的昵称，空字符串等于清除。返回整理后的昵称 */
const Body = z.object({ displayName: z.string({ error: '请填写昵称' }) });

export const PATCH: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  if (!allowAccountWrite(String(auth.userId))) return json(429, fail('操作太频繁，请稍后再试'));

  const read = await readJsonBody(request);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = Body.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));

  const service = await getAuthService();
  try {
    return json(200, ok({ displayName: service.updateDisplayName(auth.userId, parsed.data.displayName) }));
  } catch (error) {
    return rejectInput(error);
  }
};
