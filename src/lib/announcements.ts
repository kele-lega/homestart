/**
 * 公告：管理员在首页的公告弹窗里发布，所有人（包括没登录的）都能看。
 * 这里是服务端和浏览器都要用的形状和上限；校验在 core/announcements，存储在 adapters/announcements。
 * 这个模块会进浏览器，不能引用服务端代码
 */
import { jsonHeaders } from './widget-api';

export const ANNOUNCEMENT_LIMITS = {
  title: 60,
  body: 2000,
  /** 最多留多少条：再发布新的，最旧的那条被挤掉 */
  count: 50,
} as const;

export interface Announcement {
  readonly id: string;
  readonly title: string;
  /** 纯文本，按原样换行显示，不解析任何标记 */
  readonly body: string;
  readonly createdAt: number;
  /** 发布时那个管理员的昵称（没有就是用户名），之后改名不跟着变 */
  readonly author: string;
}

/** 浏览器里记下看过的最新一条的发布时间：有更新的公告时，铃铛上亮一个小红点 */
export const SEEN_STORAGE_KEY = 'home:announcements-seen';

/** 别处（首页「本站」版块的「发布公告」）派发到 window 上：管理员的公告弹窗直接打开到「写一条」 */
export const COMPOSE_EVENT = 'home:announcement-compose';

export function hasUnread(list: readonly Announcement[], seenAt: number): boolean {
  return list.some((item) => item.createdAt > seenAt);
}

export function latestAt(list: readonly Announcement[]): number {
  return list.reduce((latest, item) => Math.max(latest, item.createdAt), 0);
}

export type AnnouncementsResult =
  | { readonly ok: true; readonly list: readonly Announcement[] }
  | { readonly ok: false; readonly message: string };

/** 浏览器端调用 /api/announcements：成功时都带回整个列表 */
async function call(path: string, method: string, body?: unknown): Promise<AnnouncementsResult> {
  try {
    const response = await fetch(path, {
      method,
      headers: jsonHeaders(method),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json()) as { success?: unknown; data?: unknown; error?: unknown };
    if (envelope.success === true && Array.isArray(envelope.data)) return { ok: true, list: envelope.data as Announcement[] };
    return { ok: false, message: typeof envelope.error === 'string' && envelope.error ? envelope.error : '操作失败，请稍后再试' };
  } catch {
    return { ok: false, message: '网络出了点问题，请稍后再试' };
  }
}

export const fetchAnnouncements = () => call('/api/announcements', 'GET');

export const publishAnnouncement = (title: string, body: string) => call('/api/announcements', 'POST', { title, body });

export const removeAnnouncement = (id: string) => call(`/api/announcements/${encodeURIComponent(id)}`, 'DELETE');
