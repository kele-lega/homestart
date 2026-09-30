/**
 * 浏览器端调用登录接口（/api/auth/*）的入口，请求头约定与 widget-api.ts 一致（同源脚本识别）。
 * 这个模块不能引用服务端代码
 */
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from './widget-api';

export interface AuthEnvelope<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
}

async function call<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<AuthEnvelope<T>> {
  const response = await fetch(path, {
    method,
    headers: {
      [CLIENT_HEADER]: CLIENT_HEADER_VALUE,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  return (await response.json()) as AuthEnvelope<T>;
}

export interface CurrentUser {
  readonly username: string;
  readonly role: 'admin' | 'user';
}

export const fetchMe = (signal?: AbortSignal) => call<CurrentUser | null>('/api/auth/me', 'GET', undefined, signal);

export const login = (username: string, password: string) => call<CurrentUser>('/api/auth/login', 'POST', { username, password });

export const logout = () => call<null>('/api/auth/logout', 'POST');

export interface UserSummary {
  readonly id: number;
  readonly username: string;
  readonly role: 'admin' | 'user';
  readonly createdAt: number;
}

export const listUsers = () => call<readonly UserSummary[]>('/api/auth/users', 'GET');

export const createUser = (username: string, password: string, role: 'admin' | 'user') =>
  call<null>('/api/auth/users', 'POST', { username, password, role });

export const resetPassword = (id: number, password: string) => call<null>(`/api/auth/users/${id}`, 'PUT', { password });

export const deleteUser = (id: number) => call<null>(`/api/auth/users/${id}`, 'DELETE');
