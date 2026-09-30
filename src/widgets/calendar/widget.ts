import { z } from 'astro/zod';
import type { CalendarSettings } from '../../adapters/calendar/model';
import { clearCalendarUrl, saveCalendarUrl } from '../../adapters/calendar/service';
import { ActionInputError, defineAction, defineWidget } from '../../core/widget';
import { monthData } from './data';
import { parseMonthKey } from './month-key';

/**
 * 日历：周一在前的月历，带农历、节日节气和法定节假日；有日程的日子下面一道蓝线，点开看当天的日程。
 * 日程来自登录用户自己的 ICS 订阅（Google 日历的私密地址等）。地址只存在服务端，浏览器只看得到主机名
 */
const CalendarOptions = z.strictObject({});

export type CalendarOptions = z.infer<typeof CalendarOptions>;

// 格式、范围都在 run 里用 parseMonthKey 检查，出错时给一句完整的中文说明
const MonthQuery = z.object({ month: z.string({ error: '缺少月份' }) });

/** 翻页：某个月的格子和日程 */
const month = defineAction({
  query: MonthQuery,
  run: async (_options: CalendarOptions, { month: raw }, ctx) => {
    const key = parseMonthKey(raw);
    if (!key) throw new ActionInputError('月份格式为 YYYY-MM，只支持 1901 至 2099 年');
    return monthData(key, ctx);
  },
});

// 地址的格式、长度、能否访问都由 saveCalendarUrl 检查
const SubscribeBody = z.object({ url: z.string({ error: '缺少订阅地址' }) });

/** 保存订阅地址；只回传主机名 */
const subscribe = defineAction({
  method: 'PUT',
  query: z.object({}),
  body: SubscribeBody,
  run: async (_options: CalendarOptions, _query, { user, body }): Promise<CalendarSettings> =>
    saveCalendarUrl(user, body.url),
});

const unsubscribe = defineAction({
  method: 'DELETE',
  query: z.object({}),
  run: async (_options: CalendarOptions, _query, { user }): Promise<CalendarSettings> => clearCalendarUrl(user),
});

export default defineWidget({
  type: 'calendar',
  title: '日历',
  head: 'view',
  options: CalendarOptions,
  actions: { month, subscribe, unsubscribe },
});
