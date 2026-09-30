import { entriesByDay, type DayEntry } from '../../adapters/calendar/days';
import type { CalendarSettings } from '../../adapters/calendar/model';
import { getCalendarEvents, readCalendarSettings } from '../../adapters/calendar/service';
import type { WidgetContext } from '../../core/widget';
import { mapFeed, type FeedView } from '../../lib/feed-view';
import { localDateKey } from '../../lib/zoned-time';
import { monthGrid, type MonthGrid } from './month';
import type { MonthKey } from './month-key';

/**
 * 月历翻到某个月时浏览器拿到的全部数据：格子、格子范围内每天的日程、订阅设置（只有主机名）。
 * 只在服务端运行；Calendar.svelte 只引用这里的类型
 */
export interface MonthData {
  readonly grid: MonthGrid;
  /** 有日程的日子才有键 */
  readonly feed: FeedView<Readonly<Record<string, readonly DayEntry[]>>>;
  readonly settings: CalendarSettings;
}

export async function monthData(key: MonthKey, { user, signal, site }: WidgetContext): Promise<MonthData> {
  const timeZone = site.timezone;
  const grid = monthGrid(key, localDateKey(Date.now(), timeZone));
  const [feed, settings] = await Promise.all([
    getCalendarEvents(user, grid.range, { timeZone, signal }),
    readCalendarSettings(user),
  ]);
  return { grid, feed: mapFeed(feed, (events) => entriesByDay(events, grid.range, timeZone)), settings };
}
