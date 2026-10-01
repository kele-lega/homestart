import type { APIRoute } from 'astro';
import { fail, isCrossSite, json, ok } from '../../../../core/api';
import { allowAccountWrite, rejectInput } from '../../../../adapters/auth/http';
import { getAuthService } from '../../../../adapters/auth/service';

/** DELETE /api/account/sessions/:id：退出自己的某一台设备。当前这台不走这里（要退出请登出） */
function parseId(raw: string | undefined): number | undefined {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  if (!allowAccountWrite(String(auth.userId))) return json(429, fail('操作太频繁，请稍后再试'));
  const id = parseId(params.id);
  if (id === undefined) return json(404, fail('没有这个登录'));

  const service = await getAuthService();
  try {
    service.revokeSession(auth, id);
    return json(200, ok(null));
  } catch (error) {
    return rejectInput(error);
  }
};
