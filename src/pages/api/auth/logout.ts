import type { APIRoute } from 'astro';
import { fail, isCrossSite, json, ok } from '../../../core/api';
import { clearSessionCookie } from '../../../adapters/auth/http';
import { getAuthService } from '../../../adapters/auth/service';
import { SESSION_COOKIE } from '../../../adapters/auth/session';

export const POST: APIRoute = async ({ request, cookies }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const service = await getAuthService();
    service.logout(token);
  }
  clearSessionCookie(cookies);
  return json(200, ok(null));
};
