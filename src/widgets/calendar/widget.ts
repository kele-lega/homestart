import { z } from 'astro/zod';
import {
  createLocalEvent,
  EventFieldsSchema,
  LOCAL_PREFIX,
  removeLocalEvent,
  updateLocalEvent,
} from '../../adapters/calendar/local-events';
import { syncNow } from '../../adapters/calendar/google-sync';
import { ANONYMOUS } from '../../core/api';
import { ActionInputError, defineAction, defineWidget, type ActionContext } from '../../core/widget';
import { monthData } from './data';
import { parseMonthKey } from './month-key';

/**
 * 日历：周一在前的月历，带农历、节日节气和法定节假日；有日程的日子下面一道蓝线，点开看当天的日程。
 * 日程来自登录用户自己的 ICS 订阅（Google 日历的私密地址等），在设置页填写（/api/settings/calendar）。
 * 地址只存在服务端，浏览器只看得到主机名。
 * 登录用户还能自己添加日程（create / update / remove），按账号存在服务端，换设备登录也在；
 * 在设置页连上 Google 日历后，改动随即推到用户自己的 Google 日历（google-sync.ts），推不过去的稍后重试（sync）
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

const NoQuery = z.object({});
const IdQuery = z.object({
  id: z.string({ error: '缺少日程 id' }).startsWith(LOCAL_PREFIX, { error: '只能修改自己添加的日程' }).max(100),
});

/** 改动的结果：pending 是还没推到 Google 日历的件数，没连 Google 时没有 */
export interface SavedEvent {
  readonly id: string;
  readonly pending?: number;
}

/** 存好以后推一轮，最多等几秒；推不完的在后台继续，浏览器据 pending 提示 */
async function saved(id: string, { user, site }: Pick<ActionContext<unknown>, 'user' | 'site'>): Promise<SavedEvent> {
  const pending = await syncNow(user, site.timezone);
  return pending === undefined ? { id } : { id, pending };
}

/** 新建一件日程；返回它的 id，浏览器随后重取当前月份 */
const create = defineAction({
  method: 'POST',
  query: NoQuery,
  body: EventFieldsSchema,
  run: async (_options: CalendarOptions, _query, ctx) => saved((await createLocalEvent(ctx.user, ctx.body)).id, ctx),
});

const update = defineAction({
  method: 'PUT',
  query: IdQuery,
  body: EventFieldsSchema,
  run: async (_options: CalendarOptions, { id }, ctx) => saved((await updateLocalEvent(ctx.user, id, ctx.body)).id, ctx),
});

const remove = defineAction({
  method: 'DELETE',
  query: IdQuery,
  run: async (_options: CalendarOptions, { id }, ctx) => {
    await removeLocalEvent(ctx.user, id);
    return saved(id, ctx);
  },
});

/** 「重试」：把没推过去的再推一轮 */
const sync = defineAction({
  method: 'POST',
  query: NoQuery,
  run: async (_options: CalendarOptions, _query, { user, site }) => {
    if (user === ANONYMOUS) throw new ActionInputError('未登录');
    return { pending: await syncNow(user, site.timezone) };
  },
});

export default defineWidget({
  type: 'calendar',
  title: '日历',
  head: 'view',
  options: CalendarOptions,
  actions: { month, create, update, remove, sync },
});
