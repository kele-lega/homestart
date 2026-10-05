import { addDays, diffDays, localDateKey, localTimeText, startOfDayMs } from '../../lib/zoned-time';
import type { CalendarEvent } from './model';

/**
 * 日程落在哪几天、在某一天的列表里怎么显示：月历的标记和选中日列表、“今天”、Deadline 共用。
 * 日期一律按站点时区划分，与服务器、浏览器所在的时区无关
 */

export interface DaySpan {
  /** 第一天（含） */
  readonly first: string;
  /** 最后一天（含） */
  readonly last: string;
}

/** 日期范围，[from, to)，与日历服务的查询范围一致 */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export const ALL_DAY = '全天';
/** 从前一天延续过来的日程，当天没有开始时刻 */
export const CONTINUED = '—';

export function eventSpan(event: CalendarEvent, timeZone: string): DaySpan {
  if (event.kind === 'all-day') {
    const last = addDays(event.endDate, -1);
    // 结束日期不晚于开始日期的坏数据按单日处理
    return { first: event.startDate, last: last > event.startDate ? last : event.startDate };
  }
  const first = localDateKey(event.start, timeZone);
  // 结束时刻不含：恰好在零点结束的日程不算进下一天；没有时长的只占开始那一天
  return { first, last: event.end > event.start ? localDateKey(event.end - 1, timeZone) : first };
}

function occursOn(span: DaySpan, day: string): boolean {
  return span.first <= day && day <= span.last;
}

/** 日程在某一天的列表里的一行 */
export interface DayEntry {
  readonly id: string;
  readonly title: string;
  readonly location: string | undefined;
  /** 左栏：ALL_DAY、当天开始的钟点 'HH:mm'，或从前一天延续过来的 CONTINUED */
  readonly time: string;
  /** 从前一天延续过来的日程当天几点结束 */
  readonly until: string | undefined;
  /**
   * 定时日程真实的起止（UTC 毫秒），浏览器每分钟据此判断哪件已经过去、哪件是下一件。
   * 全天日程、以及把这一天整个占满的定时日程没有
   */
  readonly timing: { readonly start: number; readonly end: number } | undefined;
}

interface Ranked {
  readonly entry: DayEntry;
  /** 0：全天在前；1：定时 */
  readonly group: 0 | 1;
  /** 在当天露出的起止，用来排序 */
  readonly from: number;
  readonly to: number;
}

function rank(event: CalendarEvent, dayStart: number, dayEnd: number, timeZone: string): Ranked {
  const base = { id: event.id, title: event.title, location: event.location };
  if (event.kind === 'all-day' || (event.start <= dayStart && event.end >= dayEnd)) {
    return { entry: { ...base, time: ALL_DAY, until: undefined, timing: undefined }, group: 0, from: 0, to: 0 };
  }
  const startsToday = event.start >= dayStart;
  const entry: DayEntry = {
    ...base,
    time: startsToday ? localTimeText(event.start, timeZone) : CONTINUED,
    // 没在当天开始、又没占满当天，就一定在当天结束
    until: startsToday ? undefined : localTimeText(event.end, timeZone),
    timing: { start: event.start, end: event.end },
  };
  return { entry, group: 1, from: Math.max(event.start, dayStart), to: Math.min(event.end, dayEnd) };
}

/** events 都已确认落在 day 这一天 */
function entriesOn(events: readonly CalendarEvent[], day: string, timeZone: string): readonly DayEntry[] {
  const dayStart = startOfDayMs(day, timeZone);
  const dayEnd = startOfDayMs(addDays(day, 1), timeZone);
  // 全天在前；定时的按当天露出的起止排，同一时刻保持订阅里的先后（sort 是稳定的）
  return events
    .map((event) => rank(event, dayStart, dayEnd, timeZone))
    .sort((a, b) => a.group - b.group || a.from - b.from || a.to - b.to)
    .map(({ entry }) => entry);
}

/** 某一天的日程，全天的在前 */
export function dayEntries(events: readonly CalendarEvent[], day: string, timeZone: string): readonly DayEntry[] {
  return entriesOn(
    events.filter((event) => occursOn(eventSpan(event, timeZone), day)),
    day,
    timeZone,
  );
}

/** 范围内每一天的日程；没有日程的日子不出现 */
export function entriesByDay(
  events: readonly CalendarEvent[],
  { from, to }: DateRange,
  timeZone: string,
): Readonly<Record<string, readonly DayEntry[]>> {
  const spans = events.map((event) => ({ event, span: eventSpan(event, timeZone) }));
  const days = Array.from({ length: Math.max(0, diffDays(from, to)) }, (_, index) => addDays(from, index));
  return Object.fromEntries(
    days.flatMap((day) => {
      const on = spans.filter(({ span }) => occursOn(span, day)).map(({ event }) => event);
      return on.length > 0 ? [[day, entriesOn(on, day, timeZone)] as const] : [];
    }),
  );
}
