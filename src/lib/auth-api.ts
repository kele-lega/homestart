/**
 * 浏览器端调用登录接口（/api/auth/*、/api/account/*）的入口，请求头约定与 widget-api.ts 一致（同源脚本识别）。
 * 这个模块不能引用服务端代码
 */
import type { Role, SessionView, UserView } from './account-view';
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

export const changePassword = (current: string, next: string) =>
  call<{ readonly signedOut: number }>('/api/account/password', 'POST', { current, next });

export const listSessions = () => call<readonly SessionView[]>('/api/account/sessions', 'GET');

export const revokeSession = (id: number) => call<null>(`/api/account/sessions/${id}`, 'DELETE');

export const revokeOtherSessions = () => call<{ readonly signedOut: number }>('/api/account/sessions', 'DELETE');

export const listUsers = () => call<readonly UserView[]>('/api/auth/users', 'GET');

export const createUser = (username: string, password: string, role: Role) =>
  call<null>('/api/auth/users', 'POST', { username, password, role });

export const resetPassword = (id: number, password: string) => call<null>(`/api/auth/users/${id}`, 'PUT', { password });

export const deleteUser = (id: number) => call<null>(`/api/auth/users/${id}`, 'DELETE');
