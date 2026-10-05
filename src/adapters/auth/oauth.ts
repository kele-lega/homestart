/**
 * GitHub / Google 第三方登录，手写的授权码流程 + PKCE（S256）+ state，不引 SDK。
 * 只在回调那一下用对方的访问令牌取资料（编号、名字、验证过的邮箱），用完就丢，从不落库。
 * 对方回调地址固定是 <SITE_ORIGIN>/api/auth/oauth/<provider>/callback，在对方后台登记时要一字不差
 */
import { createHash, randomBytes } from 'node:crypto';
import { fetchJson } from '../../core/http';
import type { OAuthClient } from './config';
import type { Provider } from './identities';

export interface OAuthProfile {
  readonly provider: Provider;
  /** 对方的稳定编号 */
  readonly subject: string;
  /** 个人中心里显示「绑的是哪一个」 */
  readonly label: string;
  /** 对方确认验证过的邮箱（小写）；没有就是 null，不能用来注册 */
  readonly email: string | null;
  readonly displayName: string | null;
  /** 自动起用户名时的底子：GitHub 登录名、Google 邮箱 @ 前面那段 */
  readonly usernameHint: string;
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export const randomToken = () => randomBytes(32).toString('base64url');

export function createPkce(): PkcePair {
  const verifier = randomToken();
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export const callbackUrl = (siteOrigin: string, provider: Provider) => `${siteOrigin}/api/auth/oauth/${provider}/callback`;

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 65_536;

interface ProviderSpec {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scope: string;
  readonly extraParams?: Readonly<Record<string, string>>;
  fetchProfile(accessToken: string, doFetch?: typeof fetch): Promise<OAuthProfile>;
}

const GITHUB_HEADERS = { accept: 'application/vnd.github+json', 'user-agent': 'homestart', 'x-github-api-version': '2022-11-28' };

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const SPECS: Readonly<Record<Provider, ProviderSpec>> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    extraParams: { allow_signup: 'false' },
    async fetchProfile(accessToken, doFetch) {
      const headers = { ...GITHUB_HEADERS, authorization: `Bearer ${accessToken}` };
      const options = { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, headers, fetch: doFetch };
      const user = (await fetchJson('https://api.github.com/user', options)) as Record<string, unknown>;
      const emails = (await fetchJson('https://api.github.com/user/emails', options)) as unknown;
      const primary = Array.isArray(emails)
        ? (emails as Record<string, unknown>[]).find((entry) => entry.primary === true && entry.verified === true)
        : undefined;
      const login = str(user.login) ?? '';
      if (typeof user.id !== 'number' || !login) throw new Error('GitHub 返回的账号信息不完整');
      return {
        provider: 'github',
        subject: String(user.id),
        label: login,
        email: str(primary?.email)?.toLowerCase() ?? null,
        displayName: str(user.name),
        usernameHint: login,
      };
    },
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    extraParams: { prompt: 'select_account' },
    async fetchProfile(accessToken, doFetch) {
      const info = (await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
        timeoutMs: TIMEOUT_MS,
        maxBytes: MAX_BYTES,
        headers: { authorization: `Bearer ${accessToken}` },
        fetch: doFetch,
      })) as Record<string, unknown>;
      const subject = str(info.sub);
      const email = str(info.email)?.toLowerCase() ?? null;
      if (!subject) throw new Error('Google 返回的账号信息不完整');
      return {
        provider: 'google',
        subject,
        label: email ?? subject,
        email: info.email_verified === true ? email : null,
        displayName: str(info.name),
        usernameHint: email?.split('@')[0] ?? 'user',
      };
    },
  },
};

export function authorizeUrl(provider: Provider, client: OAuthClient, redirectUri: string, state: string, challenge: string): string {
  const spec = SPECS[provider];
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: spec.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...spec.extraParams,
  });
  return `${spec.authorizeUrl}?${query}`;
}

/** 拿回调里的 code 换访问令牌、取资料；任何一步失败都抛错，调用方统一当成「没取到资料」 */
export async function fetchOAuthProfile(
  provider: Provider,
  client: OAuthClient,
  redirectUri: string,
  code: string,
  verifier: string,
  doFetch?: typeof fetch,
): Promise<OAuthProfile> {
  const spec = SPECS[provider];
  const token = (await fetchJson(spec.tokenUrl, {
    method: 'POST',
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    fetch: doFetch,
  })) as Record<string, unknown> | null;
  // GitHub 换令牌失败时也回 200，错误写在 error 字段里
  const accessToken = str(token?.access_token);
  if (!accessToken) throw new Error(`${provider} 没给访问令牌：${str(token?.error) ?? '未知原因'}`);
  return spec.fetchProfile(accessToken, doFetch);
}

/**
 * 跳去对方之前把 state 和 PKCE verifier 记在一个短命 Cookie 里，回调时拿出来比对，比对完就删。
 * __Host- 前缀：只能本站 HTTPS 设、路径固定 /，子域名覆盖不了。不用签名：用户改自己的 Cookie 只会让自己的流程失败；
 * 绑定时绑到谁按回调那一刻的登录会话算，不看 Cookie
 */
export const OAUTH_COOKIE = '__Host-home_oauth';
export const OAUTH_COOKIE_TTL_S = 10 * 60;

export interface OAuthState {
  readonly provider: Provider;
  readonly state: string;
  readonly verifier: string;
  readonly mode: 'login' | 'link';
  readonly remember: boolean;
}

const TOKEN = /^[\w-]{20,128}$/;

export const encodeOAuthState = (value: OAuthState) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function decodeOAuthState(raw: string | undefined): OAuthState | null {
  if (!raw || raw.length > 1024) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    const { provider, state, verifier, mode, remember } = value;
    if (provider !== 'github' && provider !== 'google') return null;
    if (typeof state !== 'string' || !TOKEN.test(state) || typeof verifier !== 'string' || !TOKEN.test(verifier)) return null;
    if (mode !== 'login' && mode !== 'link') return null;
    return { provider, state, verifier, mode, remember: remember === true };
  } catch {
    return null;
  }
}
