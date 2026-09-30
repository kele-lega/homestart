import type { APIRoute } from 'astro';
import { fail, isCrossSite, json, ok } from '../../../core/api';

/** 当前登录状态；未登录返回 data: null，不是错误 */
export const GET: APIRoute = ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (!locals.auth) return json(200, ok(null));
  return json(200, ok({ username: locals.auth.username, role: locals.auth.role }));
};
