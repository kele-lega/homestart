import type { APIRoute } from 'astro';
import { fail, isCrossSite, json, ok } from '../../../../core/api';
import { allowAccountWrite, rejectInput } from '../../../../adapters/auth/http';
import { isProvider } from '../../../../adapters/auth/identities';
import { getRegistration } from '../../../../adapters/auth/signup';

/** DELETE /api/account/identities/:provider：解绑第三方登录；解绑后没有登录方式时拒绝 */
export const DELETE: APIRoute = async ({ request, locals, params }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  const provider = params.provider ?? '';
  if (!isProvider(provider)) return json(404, fail('没有这种登录方式'));
  if (!allowAccountWrite(String(auth.userId))) return json(429, fail('尝试太频繁，请稍后再试'));
  try {
    (await getRegistration()).unlinkIdentity(auth.userId, provider);
    return json(200, ok(null));
  } catch (error) {
    return rejectInput(error);
  }
};
