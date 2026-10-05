import { z } from 'astro/zod';
import { getCalendarEvents, MAX_RANGE_DAYS } from '../../adapters/calendar/service';
import { definePreferences, defineWidget } from '../../core/widget';
import { mapFeed, type FeedView } from '../../lib/feed-view';
import { addDays, localDateKey } from '../../lib/zoned-time';
import { deadlineRows, type DeadlineRow } from './present';

/**
 * Deadline：日历订阅里接下来的事项，按剩余天数排，最近的在前（原版是同一份订阅的议程视图）。
 * 订阅地址按登录用户保存，在日历版块里设置
 */
export const DEADLINE_LIMITS = { max: 20, days: MAX_RANGE_DAYS } as const;

const DeadlineOptions = z.strictObject({
  /** 最多列几条 */
  max: z.number().int().min(1).max(DEADLINE_LIMITS.max).default(5),
  /** 往后看多少天；每年一次的续费之类可以调到 365 */
  days: z.number().int().min(1).max(DEADLINE_LIMITS.days).default(90),
});

export type DeadlineOptions = z.infer<typeof DeadlineOptions>;

const DeadlinePreference = z.strictObject({
  max: z.number().int('条数要是整数').min(1, '至少列 1 条').max(DEADLINE_LIMITS.max, `最多列 ${DEADLINE_LIMITS.max} 条`),
  days: z.number().int('天数要是整数').min(1, '至少往后看 1 天').max(DEADLINE_LIMITS.days, `最多往后看 ${DEADLINE_LIMITS.days} 天`),
});

export type DeadlinePreference = z.infer<typeof DeadlinePreference>;
export type DeadlineData = FeedView<readonly DeadlineRow[]>;

export default defineWidget({
  type: 'deadline',
  title: 'Deadline',
  head: 'view',
  options: DeadlineOptions,
  preferences: definePreferences({
    schema: DeadlinePreference,
    apply: (options: DeadlineOptions, preference) => ({ ...options, ...preference }),
  }),
  // 缓存在日历服务里：同一页上日历、今天、Deadline 共用一次抓取
  load: async ({ max, days }: DeadlineOptions, { user, signal, site }): Promise<DeadlineData> => {
    const timeZone = site.timezone;
    const today = localDateKey(Date.now(), timeZone);
    const feed = await getCalendarEvents(user, { from: today, to: addDays(today, days) }, { timeZone, signal });
    return mapFeed(feed, (events) => deadlineRows(events, today, timeZone, max));
  },
});
