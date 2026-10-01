import type { APIRoute } from 'astro';
import { fail, isCrossSite, json, ok } from '../../../core/api';
import { allowAccountWrite } from '../../../adapters/auth/http';
import { getAuthService } from '../../../adapters/auth/service';
import { toSessionView } from '../../../lib/account-view';

/**
 * 自己的登录设备。GET 列出（当前这台标 current），DELETE 退出除当前这台以外的全部设备、返回退出了几台。
 * 退出某一台见 ./sessions/[id].ts
 */
export const GET: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  const service = await getAuthService();
  return json(200, ok(service.listSessions(auth.userId).map((session) => toSessionView(session, auth.sessionId))));
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  if (!allowAccountWrite(String(auth.userId))) return json(429, fail('操作太频繁，请稍后再试'));
  const service = await getAuthService();
  return json(200, ok({ signedOut: service.revokeOtherSessions(auth) }));
};
