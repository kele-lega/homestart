import type { APIRoute } from 'astro';
import { isProvider } from '../../../../../adapters/auth/identities';
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_TTL_S,
  authorizeUrl,
  callbackUrl,
  createPkce,
  encodeOAuthState,
  randomToken,
} from '../../../../../adapters/auth/oauth';
import { getAuthConfig } from '../../../../../adapters/auth/signup';

/**
 * GET /api/auth/oauth/<provider>?mode=login|link&remember=1：记下 state 和 PKCE，跳去 GitHub / Google 授权页。
 * mode=link 是个人中心里「绑定」，要已登录；没配这家（或没配 SITE_ORIGIN）就回登录页提示用不了
 */
export const GET: APIRoute = async ({ params, url, cookies, locals, redirect }) => {
  const provider = params.provider ?? '';
  const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login';
  const back = mode === 'link' ? '/account' : '/login';
  if (!isProvider(provider)) return redirect(`${back}?notice=oauth-unavailable`, 302);
  if (mode === 'link' && !locals.auth) return redirect('/login', 302);

  const config = getAuthConfig();
  const client = config.oauth[provider];
  if (!client || !config.siteOrigin) return redirect(`${back}?notice=oauth-unavailable`, 302);

  const state = randomToken();
  const { verifier, challenge } = createPkce();
  cookies.set(OAUTH_COOKIE, encodeOAuthState({ provider, state, verifier, mode, remember: url.searchParams.get('remember') === '1' }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_COOKIE_TTL_S,
  });
  const target = authorizeUrl(provider, client, callbackUrl(config.siteOrigin, provider), state, challenge);
  return redirect(target, 302);
};
