import { z } from 'astro/zod';
import { getCalendarEvents, MAX_RANGE_DAYS } from '../../adapters/calendar/service';
import { defineWidget } from '../../core/widget';
import { mapFeed, type FeedView } from '../../lib/feed-view';
import { addDays, localDateKey } from '../../lib/zoned-time';
import { deadlineRows, type DeadlineRow } from './present';

/**
 * Deadline：日历订阅里接下来的事项，按剩余天数排，最近的在前（原版是同一份订阅的议程视图）。
 * 订阅地址按登录用户保存，在日历版块里设置
 */
const DeadlineOptions = z.strictObject({
  /** 最多列几条 */
  max: z.number().int().min(1).max(20).default(5),
  /** 往后看多少天；每年一次的续费之类可以调到 365 */
  days: z.number().int().min(1).max(MAX_RANGE_DAYS).default(90),
});

export type DeadlineOptions = z.infer<typeof DeadlineOptions>;
export type DeadlineData = FeedView<readonly DeadlineRow[]>;

export default defineWidget({
  type: 'deadline',
  title: 'Deadline',
  head: 'view',
  options: DeadlineOptions,
  // 缓存在日历服务里：同一页上日历、今天、Deadline 共用一次抓取
  load: async ({ max, days }: DeadlineOptions, { user, signal, site }): Promise<DeadlineData> => {
    const timeZone = site.timezone;
    const today = localDateKey(Date.now(), timeZone);
    const feed = await getCalendarEvents(user, { from: today, to: addDays(today, days) }, { timeZone, signal });
    return mapFeed(feed, (events) => deadlineRows(events, today, timeZone, max));
  },
});
