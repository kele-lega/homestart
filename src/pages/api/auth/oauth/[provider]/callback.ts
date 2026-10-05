import type { APIRoute } from 'astro';
import { clientInfo, setSessionCookie } from '../../../../../adapters/auth/http';
import {
  OAUTH_COOKIE,
  callbackUrl,
  decodeOAuthState,
  fetchOAuthProfile,
  type OAuthProfile,
} from '../../../../../adapters/auth/oauth';
import { OAuthRejected, getAuthConfig, getRegistration } from '../../../../../adapters/auth/signup';

/**
 * GET /api/auth/oauth/<provider>/callback?code=…&state=…：GitHub / Google 授权完跳回来的地方。
 * 不查同站来源（对方站点跳回来本来就是跨站）；防伪靠 state 必须和发起时记在 Cookie 里的一致。
 * 结果一律重定向：登录成功回首页（新建的号去个人中心），绑定回个人中心，出错带 ?notice= 回原页面
 */
export const GET: APIRoute = async ({ params, url, cookies, locals, request, redirect }) => {
  const saved = decodeOAuthState(cookies.get(OAUTH_COOKIE)?.value);
  cookies.delete(OAUTH_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
  const back = (notice: string) => redirect(`${saved?.mode === 'link' ? '/account' : '/login'}?notice=${notice}`, 302);

  if (url.searchParams.has('error')) return back('oauth-denied');
  const code = url.searchParams.get('code');
  if (!saved || saved.provider !== params.provider || saved.state !== url.searchParams.get('state') || !code) {
    return back('oauth-expired');
  }
  if (saved.mode === 'link' && !locals.auth) return redirect('/login?notice=oauth-expired', 302);

  const config = getAuthConfig();
  const client = config.oauth[saved.provider];
  if (!client || !config.siteOrigin) return back('oauth-unavailable');

  let profile: OAuthProfile;
  try {
    profile = await fetchOAuthProfile(saved.provider, client, callbackUrl(config.siteOrigin, saved.provider), code, saved.verifier);
  } catch (error) {
    console.error(`[auth] ${saved.provider} 第三方登录取资料失败：`, error instanceof Error ? error.message : error);
    return back('oauth-failed');
  }

  try {
    const registration = await getRegistration();
    const intent =
      saved.mode === 'link' && locals.auth
        ? ({ mode: 'link', userId: locals.auth.userId } as const)
        : ({ mode: 'login', remember: saved.remember } as const);
    const outcome = registration.completeOAuth(profile, intent, clientInfo(request));
    if (outcome.kind === 'linked') return redirect('/account?notice=oauth-linked', 302);
    setSessionCookie(cookies, outcome.result.token, outcome.result.remember);
    return redirect(outcome.created ? '/account?notice=welcome' : '/', 302);
  } catch (error) {
    if (error instanceof OAuthRejected) return back(error.notice);
    throw error;
  }
};
