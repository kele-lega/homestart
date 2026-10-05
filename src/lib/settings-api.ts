/**
 * 浏览器端调用设置接口（/api/settings/*）的入口，请求头约定与 widget-api.ts 一致（同源脚本识别）。
 * 这个模块不能引用服务端代码，只引用类型
 */
import type { SyncSettings } from '../adapters/calendar/google-sync';
import type { CalendarSettings } from '../adapters/calendar/model';
import type { Place } from '../adapters/geocoding';
import type { SteamBinding } from '../adapters/steam/model';
import type { UserLinks } from '../core/user-links';
import { jsonHeaders } from './widget-api';

/** 设置页存过东西后写进 sessionStorage：首页从往返缓存（bfcache）里恢复时据此刷新，不显示旧的版面 */
export const SETTINGS_CHANGED_FLAG = 'home:settings-changed';

export type SettingsResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly message: string };

const NETWORK_ERROR = '网络出了点问题，没能保存';
const FALLBACK_ERROR = '保存失败，请稍后再试';

/** 只核对信封的形状；data 的内容是同源服务端给的 */
export function readResult<T>(body: unknown): SettingsResult<T> {
  const { success, data, error } = (typeof body === 'object' && body !== null ? body : {}) as {
    success?: unknown;
    data?: unknown;
    error?: unknown;
  };
  if (success === true) return { ok: true, data: data as T };
  return { ok: false, message: typeof error === 'string' && error ? error : FALLBACK_ERROR };
}

function markChanged(): void {
  try {
    sessionStorage.setItem(SETTINGS_CHANGED_FLAG, '1');
  } catch {
    // 存储不可用：首页按「后退」回去时可能还是旧的，刷新一下就好
  }
}

async function call<T>(path: string, method: string, body?: unknown): Promise<SettingsResult<T>> {
  let result: SettingsResult<T>;
  try {
    const response = await fetch(path, {
      method,
      headers: jsonHeaders(method),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    result = readResult<T>(await response.json());
  } catch {
    return { ok: false, message: NETWORK_ERROR };
  }
  if (result.ok && method !== 'GET') markChanged();
  return result;
}

/** { Widget 类型: 偏好 | null }，null 恢复默认；返回改完的那几项 */
export const savePreferences = (patch: Readonly<Record<string, unknown>>) =>
  call<Readonly<Record<string, unknown>>>('/api/settings/preferences', 'PATCH', patch);

export const saveCalendar = (url: string) => call<CalendarSettings>('/api/settings/calendar', 'PUT', { url });

export const clearCalendar = () => call<CalendarSettings>('/api/settings/calendar', 'DELETE');

/** 写回 Google 日历：生成口令、拿到脚本 / 保存部署地址 / 断开 */
export const prepareCalendarSync = () => call<SyncSettings>('/api/settings/calendar-sync', 'POST');

export const connectCalendarSync = (url: string) => call<SyncSettings>('/api/settings/calendar-sync', 'PUT', { url });

export const checkCalendarSync = () => call<SyncSettings>('/api/settings/calendar-sync', 'PATCH');

export const disconnectCalendarSync = () => call<SyncSettings>('/api/settings/calendar-sync', 'DELETE');

export const bindSteam = (account: string) => call<SteamBinding>('/api/settings/steam', 'PUT', { account });

export const unbindSteam = () => call<SteamBinding>('/api/settings/steam', 'DELETE');

export const searchPlaces = (query: string) =>
  call<readonly Place[]>(`/api/settings/places?${new URLSearchParams({ q: query })}`, 'GET');

/** 整份保存账号自己的网站导航；返回服务端整理过的那份 */
export const saveLinks = (links: UserLinks) => call<UserLinks>('/api/settings/links', 'PUT', links);

/** 恢复成站点的 links.yaml */
export const resetLinks = () => call<null>('/api/settings/links', 'DELETE');

/** 自动抓这个网站的图标，或者上传一张（base64），返回存在本站的图标地址 */
export const fetchSiteIcon = (url: string) => call<{ icon: string }>('/api/settings/site-icon', 'POST', { url });

export const uploadSiteIcon = (image: string) => call<{ icon: string }>('/api/settings/site-icon', 'POST', { image });
