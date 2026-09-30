import type { APIRoute } from 'astro';
import { fail, isCrossSite, json, ok } from '../../../core/api';
import { getAuthService } from '../../../adapters/auth/service';
import { SESSION_COOKIE } from '../../../adapters/auth/session';

export const POST: APIRoute = async ({ request, cookies }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    const service = await getAuthService();
    service.logout(sessionId);
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return json(200, ok(null));
};
