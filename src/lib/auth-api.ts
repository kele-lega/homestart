/**
 * 浏览器端调用登录接口（/api/auth/*、/api/account/*）的入口，请求头约定与 widget-api.ts 一致（同源脚本识别）。
 * 这个模块不能引用服务端代码
 */
import type { AvatarView, Provider, Role, SessionView, UserView } from './account-view';
import { jsonHeaders } from './widget-api';

export interface AuthEnvelope<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
}

async function call<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<AuthEnvelope<T>> {
  const response = await fetch(path, {
    method,
    headers: jsonHeaders(method),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  return (await response.json()) as AuthEnvelope<T>;
}

export interface CurrentUser {
  readonly username: string;
  readonly displayName: string | null;
  readonly role: Role;
}

export const fetchMe = (signal?: AbortSignal) => call<CurrentUser | null>('/api/auth/me', 'GET', undefined, signal);

export const login = (username: string, password: string, remember: boolean) =>
  call<CurrentUser>('/api/auth/login', 'POST', { username, password, remember });

export const logout = () => call<null>('/api/auth/logout', 'POST');

export const updateDisplayName = (displayName: string) =>
  call<{ readonly displayName: string | null }>('/api/account/profile', 'PATCH', { displayName });

/** image 是 lib/avatar-image 处理好的 data URL */
export const uploadAvatar = (image: string) => call<{ readonly avatar: AvatarView }>('/api/account/avatar', 'PUT', { image });

/** 换回注册时随机定下的默认色块图 */
export const resetAvatar = () => call<{ readonly avatar: AvatarView }>('/api/account/avatar', 'DELETE');

/** 还没有密码（只用第三方登录）的账号 current 传空串，等于第一次设置密码 */
export const changePassword = (current: string, next: string) =>
  call<{ readonly signedOut: number }>('/api/account/password', 'POST', { current, next });

/** 注册第一步：人机验证通过后往这个邮箱发验证码。turnstile 是 Turnstile 小部件给的令牌，没开人机验证时传空串 */
export const requestSignupCode = (email: string, turnstile: string) =>
  call<null>('/api/auth/signup/code', 'POST', { email, turnstile });

export interface SignupRequest {
  readonly email: string;
  readonly code: string;
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
}

/** 注册第二步：验证码对了就建号并直接登录（写会话 Cookie） */
export const signup = (request: SignupRequest) => call<CurrentUser>('/api/auth/signup', 'POST', request);

/** 找回密码第一步：不管这个邮箱有没有注册都回成功，猜不出哪些邮箱注册过 */
export const requestResetCode = (email: string, turnstile: string) =>
  call<null>('/api/auth/forgot/code', 'POST', { email, turnstile });

/** 找回密码第二步：设好新密码后这个账号的其它登录全部失效，当前浏览器直接登录 */
export const resetPasswordWithCode = (email: string, code: string, password: string) =>
  call<CurrentUser>('/api/auth/forgot', 'POST', { email, code, password });

/** 个人中心换绑（或第一次绑定）邮箱：先给新邮箱发验证码，再带着验证码提交 */
export const requestEmailCode = (email: string) => call<null>('/api/account/email/code', 'POST', { email });

export const changeEmail = (email: string, code: string) =>
  call<{ readonly email: string }>('/api/account/email', 'PUT', { email, code });

/** 解绑第三方登录；解绑后没有任何登录方式时服务端会拒绝 */
export const unlinkIdentity = (provider: Provider) => call<null>(`/api/account/identities/${provider}`, 'DELETE');

/**
 * 第三方登录 / 绑定的入口：整页跳过去（不是 fetch），对方授权后回到本站。
 * login：登录，没有账号就自动注册；link：给当前登录的账号绑定。remember 同登录表单的「记住我」
 */
export function oauthStartUrl(provider: Provider, mode: 'login' | 'link', remember = false): string {
  const query = new URLSearchParams({ mode });
  if (remember) query.set('remember', '1');
  return `/api/auth/oauth/${provider}?${query}`;
}

export const listSessions = () => call<readonly SessionView[]>('/api/account/sessions', 'GET');

export const revokeSession = (id: number) => call<null>(`/api/account/sessions/${id}`, 'DELETE');

export const revokeOtherSessions = () => call<{ readonly signedOut: number }>('/api/account/sessions', 'DELETE');

export const listUsers = () => call<readonly UserView[]>('/api/auth/users', 'GET');

export const createUser = (username: string, password: string, role: Role) =>
  call<null>('/api/auth/users', 'POST', { username, password, role });

export const resetPassword = (id: number, password: string) => call<null>(`/api/auth/users/${id}`, 'PUT', { password });

export const deleteUser = (id: number) => call<null>(`/api/auth/users/${id}`, 'DELETE');
