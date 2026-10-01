/**
 * 个人中心在服务端和浏览器之间传的数据形状，以及两边都要用的显示规则（设备名、时间、书签上的那个字）。
 * 这个模块会进浏览器，不能引用服务端代码
 */
import type { Role } from '../adapters/auth/store';
import { localDateKey, localTimeText } from './zoned-time';

export type { Role };

export interface LoginStampView {
  readonly at: number;
  readonly ip: string | null;
}

export interface AccountView {
  readonly id: number;
  readonly username: string;
  readonly displayName: string | null;
  readonly role: Role;
  readonly createdAt: number;
  readonly previousLogin: LoginStampView | null;
}

/** 「登录设备」的一行；原始 User-Agent 不下发，只给整理过的设备名 */
export interface SessionView {
  readonly id: number;
  readonly device: string;
  readonly ip: string | null;
  readonly remember: boolean;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly current: boolean;
}

export interface SessionSource {
  readonly id: number;
  readonly userAgent: string | null;
  readonly ip: string | null;
  readonly remember: boolean;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export function toSessionView(session: SessionSource, currentSessionId: number): SessionView {
  const { id, userAgent, ip, remember, createdAt, lastSeenAt } = session;
  return { id, device: describeDevice(userAgent), ip, remember, createdAt, lastSeenAt, current: id === currentSessionId };
}

/** 管理员看到的账号列表：只有最近登录的时间，不给别人的 IP */
export interface UserView {
  readonly id: number;
  readonly username: string;
  readonly displayName: string | null;
  readonly role: Role;
  readonly createdAt: number;
  readonly lastLoginAt: number | null;
}

export function toUserView(user: Omit<UserView, 'lastLoginAt'> & { readonly lastLogin: LoginStampView | null }): UserView {
  const { id, username, displayName, role, createdAt, lastLogin } = user;
  return { id, username, displayName, role, createdAt, lastLoginAt: lastLogin?.at ?? null };
}

// 顺序有讲究：Edge、Opera 的 UA 里也有 Chrome，Chrome 的 UA 里也有 Safari
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

// iPadOS 13 起默认报成 Macintosh，只能认出明确写了 iPad 的；Android 的 UA 里也有 Linux
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPad/, 'iPad'],
  [/iPhone|iPod/, 'iPhone'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const match = (ua: string, table: readonly (readonly [RegExp, string])[]) => table.find(([pattern]) => pattern.test(ua))?.[1];

/** 「Chrome · Windows」这样的设备名；认不出来的部分省略，都认不出来就是「未知设备」 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return '未知设备';
  const parts = [match(userAgent, BROWSERS), match(userAgent, SYSTEMS)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '未知设备';
}

/** 书签上显示的那个字：昵称（没有就用户名）的第一个字，拉丁字母大写 */
export function initialOf(name: string): string {
  const first = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(name.trim())[Symbol.iterator]().next();
  return first.done ? '?' : first.value.segment.toUpperCase();
}

/** 站点时区里的「2026.09.30 14:05」；服务端和浏览器算出来的一样，注水时不会对不上 */
export function formatWhen(ms: number, timeZone: string): string {
  return `${localDateKey(ms, timeZone).replaceAll('-', '.')} ${localTimeText(ms, timeZone)}`;
}
