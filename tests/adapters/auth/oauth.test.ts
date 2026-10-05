import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authorizeUrl,
  callbackUrl,
  createPkce,
  decodeOAuthState,
  encodeOAuthState,
  fetchOAuthProfile,
  randomToken,
  type OAuthState,
} from '../../../src/adapters/auth/oauth';

const CLIENT = { clientId: 'client-id', clientSecret: 'client-secret' };
const REDIRECT = 'https://home.example.org/api/auth/oauth/github/callback';

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** 按 URL 回预设的 JSON，没登记的地址回 404；记下每次请求 */
function fakeFetch(routes: Record<string, unknown>, status: Record<string, number> = {}) {
  const calls: Call[] = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (!(url in routes)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[url]), {
      status: status[url] ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { doFetch, calls };
}

const header = (call: Call | undefined, name: string) => (call?.init?.headers as Record<string, string> | undefined)?.[name];

describe('PKCE and tokens', () => {
  it('derives the S256 challenge from the verifier', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[\w-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('makes a fresh random token every time', () => {
    const token = randomToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it('builds the fixed callback address', () => {
    expect(callbackUrl('https://home.example.org', 'google')).toBe('https://home.example.org/api/auth/oauth/google/callback');
  });
});

describe('authorizeUrl', () => {
  it('sends GitHub the client, redirect, state and PKCE challenge', () => {
    const url = new URL(authorizeUrl('github', CLIENT, REDIRECT, 'state-1', 'challenge-1'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-id',
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'read:user user:email',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      allow_signup: 'false',
    });
  });

  it('asks Google for openid email profile and lets the user pick an account', () => {
    const url = new URL(authorizeUrl('google', CLIENT, REDIRECT, 'state-1', 'challenge-1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_USER = 'https://api.github.com/user';
const GITHUB_EMAILS = 'https://api.github.com/user/emails';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_INFO = 'https://openidconnect.googleapis.com/v1/userinfo';

describe('fetchOAuthProfile', () => {
  it('exchanges the code with the PKCE verifier, then reads the GitHub user and primary verified email', async () => {
    const { doFetch, calls } = fakeFetch({
      [GITHUB_TOKEN]: { access_token: 'gho_token' },
      [GITHUB_USER]: { id: 42, login: 'Octo-Cat', name: ' Octo Cat ' },
      [GITHUB_EMAILS]: [
        { email: 'old@example.com', primary: false, verified: true },
        { email: 'Octo@Example.com', primary: true, verified: true },
      ],
    });
    const profile = await fetchOAuthProfile('github', CLIENT, REDIRECT, 'the-code', 'the-verifier', doFetch);
    expect(profile).toEqual({
      provider: 'github',
      subject: '42',
      label: 'Octo-Cat',
      email: 'octo@example.com',
      displayName: 'Octo Cat',
      usernameHint: 'Octo-Cat',
    });

    const [token, user] = calls;
    expect(token?.init?.method).toBe('POST');
    expect(Object.fromEntries(token?.init?.body as URLSearchParams)).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'the-code',
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
      code_verifier: 'the-verifier',
    });
    expect(header(user, 'authorization')).toBe('Bearer gho_token');
  });

  it('gives no email when the GitHub primary email is not verified', async () => {
    const { doFetch } = fakeFetch({
      [GITHUB_TOKEN]: { access_token: 'gho_token' },
      [GITHUB_USER]: { id: 42, login: 'octo', name: null },
      [GITHUB_EMAILS]: [{ email: 'octo@example.com', primary: true, verified: false }],
    });
    const profile = await fetchOAuthProfile('github', CLIENT, REDIRECT, 'code', 'verifier', doFetch);
    expect(profile).toMatchObject({ email: null, displayName: null });
  });

  it('fails when GitHub reports a token error with HTTP 200', async () => {
    const { doFetch, calls } = fakeFetch({ [GITHUB_TOKEN]: { error: 'bad_verification_code' } });
    await expect(fetchOAuthProfile('github', CLIENT, REDIRECT, 'code', 'verifier', doFetch)).rejects.toThrow('bad_verification_code');
    expect(calls).toHaveLength(1);
  });

  it('fails when the GitHub profile has no id', async () => {
    const { doFetch } = fakeFetch({
      [GITHUB_TOKEN]: { access_token: 'gho_token' },
      [GITHUB_USER]: { login: 'octo' },
      [GITHUB_EMAILS]: [],
    });
    await expect(fetchOAuthProfile('github', CLIENT, REDIRECT, 'code', 'verifier', doFetch)).rejects.toThrow();
  });

  it('reads the Google userinfo and trusts the email only when verified', async () => {
    const routes = {
      [GOOGLE_TOKEN]: { access_token: 'ya29.token' },
      [GOOGLE_INFO]: { sub: '1098', email: 'Ken.Lee@Gmail.com', email_verified: true, name: 'Ken Lee' },
    };
    const { doFetch, calls } = fakeFetch(routes);
    expect(await fetchOAuthProfile('google', CLIENT, REDIRECT, 'code', 'verifier', doFetch)).toEqual({
      provider: 'google',
      subject: '1098',
      label: 'ken.lee@gmail.com',
      email: 'ken.lee@gmail.com',
      displayName: 'Ken Lee',
      usernameHint: 'ken.lee',
    });
    expect(header(calls[1], 'authorization')).toBe('Bearer ya29.token');

    const unverified = fakeFetch({ ...routes, [GOOGLE_INFO]: { sub: '1098', email: 'ken@gmail.com', email_verified: false } });
    expect(await fetchOAuthProfile('google', CLIENT, REDIRECT, 'code', 'verifier', unverified.doFetch)).toMatchObject({
      label: 'ken@gmail.com',
      email: null,
    });
  });

  it('fails when Google gives no subject or the token endpoint errors', async () => {
    const noSub = fakeFetch({ [GOOGLE_TOKEN]: { access_token: 'ya29.token' }, [GOOGLE_INFO]: { email: 'ken@gmail.com' } });
    await expect(fetchOAuthProfile('google', CLIENT, REDIRECT, 'code', 'verifier', noSub.doFetch)).rejects.toThrow();

    const broken = fakeFetch({ [GOOGLE_TOKEN]: { error: 'invalid_grant' } }, { [GOOGLE_TOKEN]: 400 });
    await expect(fetchOAuthProfile('google', CLIENT, REDIRECT, 'code', 'verifier', broken.doFetch)).rejects.toThrow();
  });
});

describe('OAuth state cookie', () => {
  const STATE: OAuthState = { provider: 'github', state: randomToken(), verifier: randomToken(), mode: 'link', remember: true };
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url');

  it('round-trips', () => {
    expect(decodeOAuthState(encodeOAuthState(STATE))).toEqual(STATE);
  });

  it('treats anything but true as not remembered', () => {
    expect(decodeOAuthState(encode({ ...STATE, remember: 'yes' }))?.remember).toBe(false);
  });

  it('rejects a missing, malformed or oversized cookie', () => {
    expect(decodeOAuthState(undefined)).toBeNull();
    expect(decodeOAuthState('')).toBeNull();
    expect(decodeOAuthState('not base64 json')).toBeNull();
    expect(decodeOAuthState(encode({ ...STATE, padding: 'x'.repeat(1024) }))).toBeNull();
  });

  it('rejects tampered fields', () => {
    expect(decodeOAuthState(encode({ ...STATE, provider: 'gitlab' }))).toBeNull();
    expect(decodeOAuthState(encode({ ...STATE, mode: 'admin' }))).toBeNull();
    expect(decodeOAuthState(encode({ ...STATE, state: 'short' }))).toBeNull();
    expect(decodeOAuthState(encode({ ...STATE, verifier: 'has spaces and is long enough' }))).toBeNull();
    expect(decodeOAuthState(encode({ ...STATE, state: 42 }))).toBeNull();
  });
});
