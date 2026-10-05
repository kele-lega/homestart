import { entriesByDay, type DayEntry } from '../../adapters/calendar/days';
import { lastSyncError, pendingCount, syncSoon } from '../../adapters/calendar/google-sync';
import { eventsInRange, listLocalEvents } from '../../adapters/calendar/local-events';
import { getCalendarEvents } from '../../adapters/calendar/service';
import { ANONYMOUS } from '../../core/api';
import type { WidgetContext } from '../../core/widget';
import type { EventFields } from '../../lib/event-fields';
import { mapFeed, type FeedView } from '../../lib/feed-view';
import { localDateKey } from '../../lib/zoned-time';
import { monthGrid, type MonthGrid } from './month';
import type { MonthKey } from './month-key';

/**
 * 月历翻到某个月时浏览器拿到的全部数据：格子和格子范围内每天的日程。
 * 只在服务端运行；Calendar.svelte 只引用这里的类型
 */
export interface MonthData {
  readonly grid: MonthGrid;
  /** 有日程的日子才有键 */
  readonly feed: FeedView<Readonly<Record<string, readonly DayEntry[]>>>;
  /**
   * 登录用户自己添加的、落在格子范围里的日程：id → 表单字段，点开就能改。
   * 没登录时没有，月历也就不出现「新建」
   */
  readonly own?: Readonly<Record<string, OwnEvent>>;
  /** 连了 Google 日历时还没推过去的件数（全部月份）；没连时没有 */
  readonly pending?: number;
  /** 还有没推过去的时，最近一次推送失败的原因 */
  readonly syncError?: string;
}

export interface OwnEvent {
  readonly fields: EventFields;
  /** 连了 Google 日历、这件的最近一次改动还没推过去 */
  readonly unsynced: boolean;
}

export async function monthData(key: MonthKey, { user, signal, site }: WidgetContext): Promise<MonthData> {
  const timeZone = site.timezone;
  const grid = monthGrid(key, localDateKey(Date.now(), timeZone));
  const [feed, stored, pending] = await Promise.all([
    getCalendarEvents(user, grid.range, { timeZone, signal }),
    user === ANONYMOUS ? undefined : listLocalEvents(user),
    pendingCount(user),
  ]);
  // 有没推过去的：顺手在后台补推（每分钟最多一次），不等它
  if (pending) syncSoon(user, timeZone);
  const view = mapFeed(feed, (events) => entriesByDay(events, grid.range, timeZone));
  if (!stored) return { grid, feed: view };
  const shownIds = new Set(eventsInRange(stored, grid.range, timeZone).map((event) => event.id));
  const own = Object.fromEntries(
    stored
      .filter((event) => shownIds.has(event.id))
      .map(({ id, title, location, allDay, startDate, startTime, endDate, endTime, synced }) => [
        id,
        {
          fields: { title, location, allDay, startDate, startTime, endDate, endTime },
          unsynced: pending !== undefined && !synced,
        },
      ]),
  );
  if (pending === undefined) return { grid, feed: view, own };
  const syncError = pending > 0 ? lastSyncError(user) : undefined;
  return syncError ? { grid, feed: view, own, pending, syncError } : { grid, feed: view, own, pending };
}
