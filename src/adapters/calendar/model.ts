/**
 * 日历数据的对外形状：组件只见到这些普通对象，ical.js 的类型不出适配器。
 * 全天日程用站点时区的日期键（'YYYY-MM-DD'），定时日程用 UTC 毫秒。
 */

export interface AllDayEvent {
  readonly kind: 'all-day';
  /** 每次重复各不相同：UID + 这一次的开始 */
  readonly id: string;
  readonly title: string;
  readonly location: string | undefined;
  /** 含 */
  readonly startDate: string;
  /** 不含：单日日程就是第二天 */
  readonly endDate: string;
}

export interface TimedEvent {
  readonly kind: 'timed';
  readonly id: string;
  readonly title: string;
  readonly location: string | undefined;
  /** UTC 毫秒 */
  readonly start: number;
  /** UTC 毫秒；没有时长的日程等于 start */
  readonly end: number;
}

export type CalendarEvent = AllDayEvent | TimedEvent;

export type CalendarFeed =
  | {
      readonly status: 'ok';
      readonly events: readonly CalendarEvent[];
      /** 刷新失败、先用旧数据顶着 */
      readonly stale: boolean;
      /** 这份数据从上游取回的时间（UTC 毫秒） */
      readonly fetchedAt: number;
    }
  | { readonly status: 'unconfigured' }
  /** message 是给用户看的中文说明，从不包含订阅地址 */
  | { readonly status: 'error'; readonly message: string };

/** 设置页能看到的全部信息：只有主机名，私密地址本身绝不回传浏览器 */
export type CalendarSettings = { readonly configured: false } | { readonly configured: true; readonly host: string };

export const UNTITLED = '（无标题）';
const MAX_TEXT = 200;
// 换行、制表符和其他控制字符一律当作空白
const WHITESPACE_RUN = /[\s\p{Cc}]+/gu;

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(WHITESPACE_RUN, ' ').trim();
  // 按码点截断，不会切开代理对
  const chars = Array.from(text);
  return chars.length > MAX_TEXT ? chars.slice(0, MAX_TEXT).join('').trimEnd() : text;
}

export function normalizeTitle(value: unknown): string {
  return clean(value) || UNTITLED;
}

export function normalizeLocation(value: unknown): string | undefined {
  return clean(value) || undefined;
}
