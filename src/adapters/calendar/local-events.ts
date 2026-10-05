/**
 * 用户自己添加的日程：存在服务端，按账号保存，所以换一台设备登录看到的是同一份。
 * 一个 JSON 文件 { 用户名: [日程, …] }，路径取环境变量 CALENDAR_EVENTS_FILE，默认 data/calendar-events.json；
 * 读写规则（现读、原子写入、权限、保留读不懂的用户条目）见 ../user-store。
 * 日历服务把这里和订阅（ICS）合在一起给三个日历类版块。
 * 连上了 Google 日历（google-sync.ts）时，每次改动都记成「待同步」，由同步模块推到用户自己的 Google 日历；
 * 推过去的那件在订阅里也会出现（同一个 UID），日历服务据此把订阅里的那份藏起来，不会显示两遍。
 * 删除推过去的日程先留一个墓碑（deleted），等推完、订阅也跟上了再清掉
 */
import { randomUUID } from 'node:crypto';
import { z } from 'astro/zod';
import { ANONYMOUS } from '../../core/api';
import { ActionInputError } from '../../core/widget';
import { EVENT_LIMITS, fieldsProblem, tidyFields, type EventFields } from '../../lib/event-fields';
import { addDays, zonedWallTimeToMs } from '../../lib/zoned-time';
import { createUserStore, settingsFilePath, type UserStore } from '../user-store';
import { eventSpan, type DateRange } from './days';
import { normalizeLocation, normalizeTitle, type CalendarEvent } from './model';

export const DEFAULT_EVENTS_FILE = 'data/calendar-events.json';
/** 自己添加的日程的 id 前缀：和订阅里的 UID 分开，浏览器据此知道哪些能改 */
export const LOCAL_PREFIX = 'local:';

export function eventsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'CALENDAR_EVENTS_FILE', DEFAULT_EVENTS_FILE);
}

export interface StoredEvent extends EventFields {
  /** 带 LOCAL_PREFIX */
  readonly id: string;
  /** 最后一次保存的时间（UTC 毫秒）；同步时据此判断推送期间有没有又改过 */
  readonly updatedAt: number;
  /** 推到 Google 日历以后它那边的 iCalUID，订阅里同一件日程的 UID 就是它 */
  readonly uid?: string;
  /** uid 在哪个 Google 日历里（日历 id）；没有就是脚本账号的默认日历 */
  readonly cal?: string;
  /** 最近一次改动已经推过去了；没连 Google 时一直是 false */
  readonly synced?: boolean;
  /** 墓碑：用户删掉了，等推完删除、订阅跟上以后清掉（删除的时间在 updatedAt） */
  readonly deleted?: boolean;
}

/** 推完的墓碑留多久：订阅那边一般几分钟内跟上，留两天足够 */
const TOMBSTONE_MS = 2 * 24 * 3_600_000;

/** 请求体：和表单字段一一对应 */
export const EventFieldsSchema = z.strictObject({
  title: z.string({ error: '请填写标题' }).max(1000),
  location: z.string().max(1000).default(''),
  allDay: z.boolean(),
  startDate: z.string(),
  startTime: z.string().default(''),
  endDate: z.string(),
  endTime: z.string().default(''),
});

const StoredSchema = z.object({
  id: z.string().startsWith(LOCAL_PREFIX).max(100),
  title: z.string(),
  location: z.string(),
  allDay: z.boolean(),
  startDate: z.string(),
  startTime: z.string(),
  endDate: z.string(),
  endTime: z.string(),
  updatedAt: z.number(),
  uid: z.string().max(300).optional(),
  cal: z.string().max(300).optional(),
  synced: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

/** 文件里读不懂的单条日程跳过；不是数组的整个用户条目读作没有 */
function parseList(value: unknown): readonly StoredEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const parsed = StoredSchema.safeParse(item);
    return parsed.success && !fieldsProblem(parsed.data) ? [parsed.data] : [];
  });
}

export class LocalEventsStoreError extends Error {
  constructor() {
    super('日程文件格式有误');
    this.name = 'LocalEventsStoreError';
  }
}

/**
 * 一次推送的结果：pushed 推成功了（uid 是 Google 那边的，cal 是它所在的日历，默认日历为 undefined），
 * gone 是 Google 那边已经没有了
 */
export type PushOutcome =
  | { readonly kind: 'pushed'; readonly uid: string | undefined; readonly cal: string | undefined }
  | { readonly kind: 'gone' };

export interface LocalEventsService {
  /** 用户看得到的日程（不含墓碑） */
  list(user: string): Promise<readonly StoredEvent[]>;
  /** 全部记录，含墓碑：同步和去重用 */
  records(user: string): Promise<readonly StoredEvent[]>;
  create(user: string, fields: EventFields): Promise<StoredEvent>;
  update(user: string, id: string, fields: EventFields): Promise<StoredEvent>;
  remove(user: string, id: string): Promise<void>;
  /**
   * 推送完成后记下结果。pushedAt 是推送时那条记录的 updatedAt：推送期间又改过就只记 uid，仍然待同步。
   * 返回推送期间被彻底删掉、Google 那边却刚建出来的 uid（要再推一次删除），没有时 undefined
   */
  markPushed(user: string, id: string, pushedAt: number, outcome: PushOutcome): Promise<string | undefined>;
}

export interface LocalEventsDeps {
  readonly store?: UserStore<readonly StoredEvent[]>;
  readonly clock?: () => number;
  readonly newId?: () => string;
}

export function createLocalEventsStore(filePath: () => string = () => eventsFilePath()): UserStore<readonly StoredEvent[]> {
  return createUserStore({
    filePath,
    parse: parseList,
    formatError: () => new LocalEventsStoreError(),
    log: { label: 'calendar', message: '日程文件读不懂，所有用户按没有日程处理' },
  });
}

function checked(fields: EventFields): EventFields {
  const tidy = tidyFields(fields);
  const problem = fieldsProblem(tidy);
  if (problem) throw new ActionInputError(problem);
  // 全天日程的钟点没有意义，存成空的，免得以后改成定时时带出旧值
  return tidy.allDay ? { ...tidy, startTime: '', endTime: '' } : tidy;
}

function requireUser(user: string): void {
  if (user === ANONYMOUS) throw new ActionInputError('登录后才能添加日程');
}

export function createLocalEvents(deps: LocalEventsDeps = {}): LocalEventsService {
  const { store = createLocalEventsStore(), clock = Date.now, newId = randomUUID } = deps;
  // 读出、改、写回要整个排队：store.put 本身串行，但两次并发的「读 → 改」会互相覆盖
  let queue: Promise<unknown> = Promise.resolve();

  function mutate<T>(user: string, change: (list: readonly StoredEvent[]) => { list: readonly StoredEvent[]; result: T }): Promise<T> {
    const task = queue.then(async () => {
      const { list, result } = change((await store.get(user)) ?? []);
      await store.put(user, list.length > 0 ? list : undefined);
      return result;
    });
    queue = task.catch(() => undefined);
    return task;
  }

  function find(list: readonly StoredEvent[], id: string): number {
    const index = list.findIndex((event) => event.id === id && !event.deleted);
    if (index < 0) throw new ActionInputError('这件日程已经不在了，可能在别的设备上删掉了');
    return index;
  }

  /** 推完、过了保留期的墓碑 */
  const purge = (list: readonly StoredEvent[]) =>
    list.filter((event) => !(event.deleted && event.synced && clock() - event.updatedAt > TOMBSTONE_MS));

  async function records(user: string): Promise<readonly StoredEvent[]> {
    if (user === ANONYMOUS) return [];
    return (await store.get(user)) ?? [];
  }

  return {
    async list(user) {
      return (await records(user)).filter((event) => !event.deleted);
    },
    records,
    async create(user, fields) {
      requireUser(user);
      const clean = checked(fields);
      return mutate(user, (list) => {
        if (list.filter((event) => !event.deleted).length >= EVENT_LIMITS.perUser) {
          throw new ActionInputError(`最多保存 ${EVENT_LIMITS.perUser} 件日程`);
        }
        const event: StoredEvent = { ...clean, id: `${LOCAL_PREFIX}${newId()}`, updatedAt: clock(), synced: false };
        return { list: [...purge(list), event], result: event };
      });
    },
    async update(user, id, fields) {
      requireUser(user);
      const clean = checked(fields);
      return mutate(user, (list) => {
        const index = find(list, id);
        const { uid, cal } = list[index]!;
        const event: StoredEvent = { ...clean, id, uid, cal, updatedAt: clock(), synced: false };
        return { list: purge(list.with(index, event)), result: event };
      });
    },
    async remove(user, id) {
      requireUser(user);
      return mutate(user, (list) => {
        const index = find(list, id);
        const old = list[index]!;
        // 从没推过去的直接删；推过去的留墓碑，等同步把 Google 那边的也删掉
        const next = old.uid ? list.with(index, { ...old, deleted: true, synced: false, updatedAt: clock() }) : list.toSpliced(index, 1);
        return { list: purge(next), result: undefined };
      });
    },
    markPushed(user, id, pushedAt, outcome) {
      return mutate(user, (list) => {
        const index = list.findIndex((event) => event.id === id);
        const uid = outcome.kind === 'pushed' ? outcome.uid : undefined;
        // 推送期间被彻底删掉了（当时还没有 uid）：Google 那边刚建的这件成了孤儿
        if (index < 0) return { list, result: uid };
        const event = list[index]!;
        const current = event.updatedAt === pushedAt;
        if (event.deleted) {
          // 删除推完了，或者推的是更早的一次修改：把 uid 记上，下一轮推删除
          // 推的是挪日历（换了新 uid）：旧的那件已经没了，下一轮删新的
          if (uid && uid !== event.uid) {
            const cal = outcome.kind === 'pushed' ? outcome.cal : undefined;
            return { list: list.with(index, { ...event, uid, cal, synced: false }), result: undefined };
          }
          const done = current || outcome.kind === 'gone';
          return { list: list.with(index, { ...event, synced: done }), result: undefined };
        }
        if (outcome.kind === 'gone') {
          // Google 那边被删了：用户在 Google 里删掉的，这边也删掉
          return { list: list.toSpliced(index, 1), result: undefined };
        }
        // 有新 uid（新建、挪到别的日历）时连同所在的日历一起换掉
        const placed = uid ? { uid, cal: outcome.kind === 'pushed' ? outcome.cal : undefined } : {};
        return { list: list.with(index, { ...event, ...placed, synced: current }), result: undefined };
      });
    },
  };
}

/** 存着的墙上时间 → 日历服务的统一形状；站点时区决定定时日程的真实时刻 */
export function toCalendarEvent(event: StoredEvent, timeZone: string): CalendarEvent {
  const base = { id: event.id, title: normalizeTitle(event.title), location: normalizeLocation(event.location) };
  if (event.allDay) return { ...base, kind: 'all-day', startDate: event.startDate, endDate: addDays(event.endDate, 1) };
  const at = (date: string, time: string) => {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const [hour, minute] = time.split(':').map(Number) as [number, number];
    return zonedWallTimeToMs(year, month, day, hour, minute, 0, timeZone);
  };
  const start = at(event.startDate, event.startTime);
  return { ...base, kind: 'timed', start, end: Math.max(start, at(event.endDate, event.endTime)) };
}

/** 落在范围 [from, to) 里的日程 */
export function eventsInRange(events: readonly StoredEvent[], { from, to }: DateRange, timeZone: string): readonly CalendarEvent[] {
  return events
    .map((event) => toCalendarEvent(event, timeZone))
    .filter((event) => {
      const span = eventSpan(event, timeZone);
      return span.last >= from && span.first < to;
    });
}

/** 全进程共用一个：读改写的队列只有排在同一个实例里才有用（同步模块也用它） */
export const defaultLocalEvents = createLocalEvents();

export const {
  list: listLocalEvents,
  records: localEventRecords,
  create: createLocalEvent,
  update: updateLocalEvent,
  remove: removeLocalEvent,
  markPushed: markLocalEventPushed,
} = defaultLocalEvents;

/** 订阅里的日程 id 是「UID@这一次的开始」（同一 UID 重复出现的再带 #2）：属于这些 UID 的藏起来 */
export function hiddenByOwn(records: readonly StoredEvent[]): (eventId: string) => boolean {
  const prefixes = records.flatMap((event) => (event.uid ? [`${event.uid}@`] : []));
  return (eventId) => prefixes.some((prefix) => eventId.startsWith(prefix));
}
