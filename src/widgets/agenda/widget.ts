import { z } from 'astro/zod';
import { dayEntries, type DayEntry } from '../../adapters/calendar/days';
import { getCalendarEvents } from '../../adapters/calendar/service';
import { defineWidget } from '../../core/widget';
import { mapFeed, type FeedView } from '../../lib/feed-view';
import { addDays, localDateKey } from '../../lib/zoned-time';

/**
 * 今天：日历订阅里今天的日程，全天的在前，其余按时间。已经过去的变淡、下一件标蓝，浏览器每分钟更新一次。
 * 订阅地址按登录用户保存，在日历版块里设置
 */
const AgendaOptions = z.strictObject({});

export type AgendaOptions = z.infer<typeof AgendaOptions>;
export type AgendaData = FeedView<readonly DayEntry[]>;

export default defineWidget({
  type: 'agenda',
  title: '今天',
  head: 'view',
  options: AgendaOptions,
  // 缓存在日历服务里：同一页上日历、今天、Deadline 共用一次抓取
  load: async (_options: AgendaOptions, { user, signal, site }): Promise<AgendaData> => {
    const timeZone = site.timezone;
    const today = localDateKey(Date.now(), timeZone);
    const feed = await getCalendarEvents(user, { from: today, to: addDays(today, 1) }, { timeZone, signal });
    return mapFeed(feed, (events) => dayEntries(events, today, timeZone));
  },
});
