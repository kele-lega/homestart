import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../../core/api';
import { formatIssues } from '../../../core/config-error';
import { allowPasswordChange, rejectInput } from '../../../adapters/auth/http';
import { getAuthService } from '../../../adapters/auth/service';

/**
 * POST /api/account/password：改自己的密码，必须给出当前密码（还没设过密码的账号 current 传空串，等于第一次设置）。
 * 成功后其它设备全部退出（当前这台保留），返回退出了几台
 */
const Body = z.object({
  current: z.string({ error: '请填写当前密码' }),
  next: z.string({ error: '请填写新密码' }),
});

export const POST: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  // 当前密码也是能猜的：被人拿到了会话，也不能借这里暴力试出密码
  if (!allowPasswordChange(String(auth.userId))) return json(429, fail('尝试太频繁，请稍后再试'));

  const read = await readJsonBody(request);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = Body.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));

  const service = await getAuthService();
  try {
    const signedOut = await service.changePassword(auth, parsed.data.current, parsed.data.next);
    return json(200, ok({ signedOut }));
  } catch (error) {
    return rejectInput(error);
  }
};
