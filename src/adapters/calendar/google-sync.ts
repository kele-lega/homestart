/**
 * 把自己添加的日程写进用户自己的 Google 日历。每个用户各自部署一个 Google Apps Script 网页应用：
 * 脚本以用户本人的身份运行、只碰他自己的默认日历，这边只存它的地址和一个随机口令，不需要 OAuth、Cloud 项目或公网域名。
 * 设置存在 data/calendar-sync.json（环境变量 CALENDAR_SYNC_FILE）：{ 用户名: { secret, url? } }，
 * 脚本地址加口令就能改这个人的日历，读写规则同 ../user-store（0600、原子写入），日志里不出现地址和口令。
 *
 * 同步是单向的：本站 → Google。每次改动先存本地（local-events，标成待同步），再按用户排队推过去；
 * 推不过去（断网、脚本没部署好）就留着，下次改动、打开月历或点「重试」时再推。
 * Google 那边有了以后，订阅（ICS）里会再出现一次，日历服务按 UID 只显示本地那份
 */
import { randomBytes } from 'node:crypto';
import { z } from 'astro/zod';
import { ANONYMOUS } from '../../core/api';
import { UpstreamError } from '../../core/http';
import { logBackgroundError } from '../../core/log';
import { ActionInputError } from '../../core/widget';
import { addDays } from '../../lib/zoned-time';
import { createUserStore, settingsFilePath, type UserStore } from '../user-store';
import {
  defaultLocalEvents,
  toCalendarEvent,
  type LocalEventsService,
  type PushOutcome,
  type StoredEvent,
} from './local-events';
import { createCalendarStore } from './store';

export const DEFAULT_SYNC_FILE = 'data/calendar-sync.json';

export function syncFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'CALENDAR_SYNC_FILE', DEFAULT_SYNC_FILE);
}

export interface SyncConfig {
  readonly secret: string;
  /** 部署好的网页应用地址；没有就是还没连上 */
  readonly url?: string;
  /** 最近一次试连时脚本报的目标日历名，给设置页显示 */
  readonly calendarName?: string;
}

/** 设置页看到的：连上了只给待同步的件数；没连上给要复制的脚本（含口令，只有本人看得到） */
export type SyncSettings =
  | {
      readonly connected: true;
      readonly pending: number;
      /** 写进去的日历名（最近一次试连时脚本报的） */
      readonly calendar: string | undefined;
      /** 最近一次推送失败的原因；推成功后清掉 */
      readonly error: string | undefined;
      /** 脚本升级时要重新复制 */
      readonly script: string;
    }
  | { readonly connected: false; readonly script: string | undefined };

const ConfigSchema = z.object({
  secret: z.string().min(32).max(128),
  url: z.string().max(400).optional(),
  calendarName: z.string().max(200).optional(),
});

// 个人账号 /macros/s/<id>/exec，Workspace 账号 /a/macros/<域名>/s/<id>/exec
const SCRIPT_PATH = /^\/(?:a\/macros\/[\w.-]{1,100}|macros)\/s\/[\w-]{20,200}\/exec$/;
const SCRIPT_HOST = 'script.google.com';
// 网页应用的响应先 302 到这里取结果
const RESULT_HOST = 'script.googleusercontent.com';
export const SYNC_TIMEOUT_MS = 15_000;
/** 脚本的协议版本：改了脚本就加一，旧脚本推送时会提示用户更新 */
export const SCRIPT_VERSION = 2;
const MAX_REPLY_BYTES = 64 * 1024;
/** 改动以后等推送的最长时间；超过就先告诉用户「还在同步」，推送在后台继续 */
export const SYNC_BUDGET_MS = 8_000;
/** 打开月历顺手补推的间隔 */
const RETRY_EVERY_MS = 60_000;

/** 只认 Apps Script 网页应用的地址：固定的主机，查询串、锚点去掉 */
export function normalizeScriptUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hostname !== SCRIPT_HOST || url.port || url.username || url.password) return undefined;
  return SCRIPT_PATH.test(url.pathname) ? `https://${SCRIPT_HOST}${url.pathname}` : undefined;
}

/** 脚本连不上、回的不对：消息给用户看，不含地址和口令 */
export class SyncError extends UpstreamError {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/**
 * 网页应用回的错误码换成能照着改的话。本站不带 Google 登录去调脚本：
 * 「有权访问的人」选了「只有我自己」「拥有 Google 账号的任何用户」或只限本组织时，Apps Script 回 401 / 403；
 * 改了访问权限要「管理部署 → 编辑 → 新版本」才生效。地址拼错、部署被删掉是 404
 */
export function statusHint(status: number): string {
  if (status === 401 || status === 403) {
    return `Google 日历脚本拒绝访问（${status}）：部署时「执行身份」选「我」、「有权访问的人」选「任何人」（不是「拥有 Google 账号的任何用户」），改完要部署新版本`;
  }
  if (status === 404) return 'Google 日历脚本不存在（404）：确认粘贴的是「部署」后给的 /exec 地址，并且这个部署还在';
  return `Google 日历脚本返回 ${status}，请检查脚本地址和部署`;
}

/** 用户复制到 Apps Script 里的全部代码；口令写在里面。改了这里要把 SCRIPT_VERSION 加一 */
export function scriptSource(secret: string): string {
  return `// homestart → Google 日历（第 ${SCRIPT_VERSION} 版）。部署为网页应用：执行身份「我」，有权访问的人「任何人」
// 更新脚本：粘贴新代码保存 →「部署」→「管理部署」→ 铅笔 → 版本选「新版本」→ 部署（网址不变）
const SECRET = '${secret}';
const VERSION = ${SCRIPT_VERSION};

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad-request' });
  }
  if (body.secret !== SECRET) return reply({ ok: false, error: 'forbidden' });
  try {
    return reply(handle(body));
  } catch (err) {
    return reply({ ok: false, error: String((err && err.message) || err) });
  }
}

// 没给日历 id 就是默认日历
function calendarOf(id) {
  if (!id) return CalendarApp.getDefaultCalendar();
  const calendar = CalendarApp.getCalendarById(id);
  if (!calendar) throw new Error('找不到这个日历，或者这个账号没有它的权限：' + id);
  return calendar;
}

function handle(body) {
  const target = calendarOf(body.calendar);
  if (body.op === 'ping') return { ok: true, calendar: target.getName() };
  // 上次写进的日历可能不是这次的目标（换过订阅），去原来那个日历里找
  const home = body.uid ? calendarOf(body.from) : null;
  const existing = home ? home.getEventById(body.uid) : null;
  if (body.op === 'delete') {
    if (existing) existing.deleteEvent();
    return { ok: true };
  }
  if (body.op !== 'upsert') return { ok: false, error: 'bad-op' };
  // 在 Google 日历里已经删掉了
  if (body.uid && !existing) return { ok: true, gone: true };
  const e = body.event;
  let event = existing;
  // 换了日历：在新日历里建一件，删掉旧的
  if (event && home.getId() !== target.getId()) {
    event.deleteEvent();
    event = null;
  }
  if (e.allDay) {
    const start = dateOf(e.startDate);
    const end = dateOf(e.endDate);
    if (event) event.setAllDayDates(start, end);
    else event = target.createAllDayEvent(e.title, start, end);
  } else {
    const start = new Date(e.start);
    const end = new Date(e.end);
    if (event) event.setTime(start, end);
    else event = target.createEvent(e.title, start, end);
  }
  event.setTitle(e.title);
  event.setLocation(e.location || '');
  return { ok: true, uid: event.getId() };
}

function dateOf(key) {
  const parts = key.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function reply(data) {
  data.version = VERSION;
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

/** calendar：要写进的日历 id；from：uid 现在所在的日历 id。都没有就是默认日历 */
type Payload =
  | { readonly op: 'ping'; readonly calendar: string | undefined }
  | { readonly op: 'delete'; readonly uid: string; readonly from: string | undefined; readonly calendar: string | undefined }
  | {
      readonly op: 'upsert';
      readonly uid: string | undefined;
      readonly from: string | undefined;
      readonly calendar: string | undefined;
      readonly event: Readonly<Record<string, unknown>>;
    };

interface Reply {
  readonly uid?: string;
  readonly gone?: boolean;
  readonly calendar?: string;
}

const ReplySchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  uid: z.string().max(300).optional(),
  gone: z.boolean().optional(),
  calendar: z.string().max(200).optional(),
  version: z.number().optional(),
});

/** 订阅地址是 Google 日历的私密地址时，从里面取日历 id：/calendar/ical/<id>/private-…/basic.ics */
export function googleCalendarIdOf(subscription: string | undefined): string | undefined {
  if (!subscription) return undefined;
  let url: URL;
  try {
    url = new URL(subscription);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'calendar.google.com') return undefined;
  const [, first, second, id] = url.pathname.split('/');
  if (first !== 'calendar' || second !== 'ical' || !id) return undefined;
  try {
    const decoded = decodeURIComponent(id);
    return /^[\w.@+-]{3,300}$/.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** 全天日程给 Google 的结束日期不含当天；定时的给 UTC 毫秒 */
function eventPayload(event: StoredEvent, timeZone: string): Readonly<Record<string, unknown>> {
  const base = { title: event.title, location: event.location, allDay: event.allDay };
  if (event.allDay) return { ...base, startDate: event.startDate, endDate: addDays(event.endDate, 1) };
  const timed = toCalendarEvent(event, timeZone);
  return timed.kind === 'timed' ? { ...base, start: timed.start, end: timed.end } : base;
}

/** 要推：最近的改动还没推过去，或者还在、却不在现在的目标日历里（换过订阅、旧版脚本写进了默认日历） */
function needsPush(event: StoredEvent, target: string | undefined): boolean {
  return !event.synced || (!event.deleted && !!event.uid && event.cal !== target);
}

export interface GoogleSyncDeps {
  readonly store?: UserStore<SyncConfig>;
  readonly local?: LocalEventsService;
  /** 用户的订阅地址：决定写进哪个日历 */
  readonly subscription?: (user: string) => Promise<string | undefined>;
  readonly fetch?: typeof fetch;
  readonly newSecret?: () => string;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface GoogleSync {
  readSyncSettings(user: string): Promise<SyncSettings>;
  /** 准备连接：没有口令就生成一个，返回要复制的脚本 */
  prepareSync(user: string): Promise<SyncSettings>;
  /** 地址不对、脚本不通时抛 ActionInputError；连上后马上把待同步的推过去 */
  connectSync(user: string, url: string, timeZone: string): Promise<SyncSettings>;
  /** 已连接时再试连一次（更新脚本以后用），通了就补推 */
  checkSync(user: string, timeZone: string): Promise<SyncSettings>;
  /** 断开：去掉地址，口令留着，重新连接时同一份脚本还能用 */
  disconnectSync(user: string): Promise<SyncSettings>;
  /** 已连接时返回待同步的件数，没连接时 undefined */
  pendingCount(user: string): Promise<number | undefined>;
  /** 最近一次推送失败的原因（给用户看的），推成功后没有 */
  lastSyncError(user: string): string | undefined;
  /** 推一轮，最多等 SYNC_BUDGET_MS；返回之后还剩几件没推（没连接时 undefined） */
  syncNow(user: string, timeZone: string): Promise<number | undefined>;
  /** 后台补推，同一个用户每分钟最多一次；不等结果 */
  syncSoon(user: string, timeZone: string): void;
}

export function createGoogleSync(deps: GoogleSyncDeps = {}): GoogleSync {
  const {
    store = createUserStore({
      filePath: () => syncFilePath(),
      parse: (value) => {
        const parsed = ConfigSchema.safeParse(value);
        if (!parsed.success) return undefined;
        const { secret, calendarName } = parsed.data;
        const url = parsed.data.url && normalizeScriptUrl(parsed.data.url);
        return { secret, ...(url ? { url } : {}), ...(calendarName ? { calendarName } : {}) };
      },
      formatError: () => new Error('日历同步设置文件格式有误'),
      log: { label: 'calendar-sync', message: '日历同步设置文件读不懂，所有用户按未连接处理' },
    }),
    local = defaultLocalEvents,
    newSecret = () => randomBytes(24).toString('base64url'),
    now = () => performance.now(),
    timeoutMs = SYNC_TIMEOUT_MS,
  } = deps;
  const doFetch = deps.fetch ?? fetch;
  const subscriptionStore = deps.subscription ? undefined : createCalendarStore();
  const subscription = deps.subscription ?? ((user: string) => subscriptionStore!.get(user));

  const running = new Map<string, Promise<void>>();
  const queued = new Map<string, Promise<void>>();
  const lastTry = new Map<string, number>();
  /** 最近一次失败的原因：给用户看，同样的失败也只记一次日志 */
  const lastError = new Map<string, string>();

  /** 写进哪个日历：订阅的是 Google 日历就是那一个，否则默认日历（undefined） */
  async function targetOf(user: string): Promise<string | undefined> {
    return googleCalendarIdOf(await subscription(user));
  }

  async function call(url: string, secret: string, payload: Payload): Promise<Reply> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        // text/plain：Apps Script 照样能读 postData.contents
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, secret }),
        redirect: 'manual',
        signal,
      });
      // 网页应用先 302 到 googleusercontent 取结果；只跟这一跳、只认这个主机
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        const next = location ? new URL(location, url) : undefined;
        if (!next || next.protocol !== 'https:' || next.hostname !== RESULT_HOST) {
          throw new SyncError('脚本要求登录：部署时「有权访问的人」要选「任何人」');
        }
        response = await doFetch(next, { redirect: 'manual', signal });
      }
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError(signal.aborted ? 'Google 日历脚本响应超时' : '连不上 Google 日历脚本');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SyncError(statusHint(response.status));
    }
    const text = (await response.text()).slice(0, MAX_REPLY_BYTES);
    let reply: z.infer<typeof ReplySchema>;
    try {
      reply = ReplySchema.parse(JSON.parse(text));
    } catch {
      throw new SyncError('脚本的回应读不懂：确认粘贴的是完整的脚本，并且部署的是最新版本');
    }
    // 旧版脚本不认 calendar 参数，会写进默认日历：先拦下，不让它写错地方
    if ((reply.version ?? 1) < SCRIPT_VERSION) {
      throw new SyncError('Google 日历脚本需要更新：到设置页复制新脚本，粘贴保存后「管理部署」→ 编辑 → 版本选「新版本」→ 部署');
    }
    if (!reply.ok) {
      throw new SyncError(reply.error === 'forbidden' ? '口令不对：重新复制设置页上的脚本，部署新版本' : `Google 日历报错：${reply.error ?? '未知错误'}`);
    }
    return reply;
  }

  async function flush(user: string, timeZone: string): Promise<void> {
    const config = await store.get(user);
    if (!config?.url) return;
    const target = await targetOf(user);
    const pending = (await local.records(user)).filter((event) => needsPush(event, target));
    for (const event of pending) {
      let outcome: PushOutcome;
      if (event.deleted && !event.uid) {
        outcome = { kind: 'gone' };
      } else {
        const payload: Payload = event.deleted
          ? { op: 'delete', uid: event.uid!, from: event.cal, calendar: target }
          : { op: 'upsert', uid: event.uid, from: event.cal, calendar: target, event: eventPayload(event, timeZone) };
        // 失败直接抛出：这一轮停下，剩下的下次再推
        const reply = await call(config.url, config.secret, payload);
        outcome = reply.gone ? { kind: 'gone' } : { kind: 'pushed', uid: reply.uid, cal: target };
      }
      const orphan = await local.markPushed(user, event.id, event.updatedAt, outcome);
      if (orphan) await call(config.url, config.secret, { op: 'delete', uid: orphan, from: target, calendar: target });
    }
    lastError.delete(user);
  }

  function start(user: string, timeZone: string): Promise<void> {
    const task = flush(user, timeZone).finally(() => running.delete(user));
    running.set(user, task);
    return task;
  }

  /** 每个用户同时只有一轮；正在推时再来的请求合并成紧接着的下一轮（期间的新改动也能推上） */
  function sync(user: string, timeZone: string): Promise<void> {
    const active = running.get(user);
    if (!active) return start(user, timeZone);
    const waiting = queued.get(user);
    if (waiting) return waiting;
    const next = active
      .catch(() => undefined)
      .then(() => {
        queued.delete(user);
        return start(user, timeZone);
      });
    queued.set(user, next);
    return next;
  }

  function report(user: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (lastError.get(user) === message) return;
    lastError.set(user, message);
    logBackgroundError('calendar-sync', `${user} 的日程同步到 Google 日历失败`, message);
  }

  async function pendingCount(user: string): Promise<number | undefined> {
    if (user === ANONYMOUS) return undefined;
    const config = await store.get(user);
    if (!config?.url) return undefined;
    const [records, target] = await Promise.all([local.records(user), targetOf(user)]);
    return records.filter((event) => needsPush(event, target)).length;
  }

  async function settingsOf(user: string, config: SyncConfig | undefined): Promise<SyncSettings> {
    if (config?.url) {
      return {
        connected: true,
        pending: (await pendingCount(user)) ?? 0,
        calendar: config.calendarName,
        error: lastError.get(user),
        script: scriptSource(config.secret),
      };
    }
    return { connected: false, script: config ? scriptSource(config.secret) : undefined };
  }

  function requireUser(user: string): void {
    if (user === ANONYMOUS) throw new ActionInputError('未登录，无法设置日历同步');
  }

  /** 试连：返回目标日历的名字；不通时抛 ActionInputError（中文说明） */
  async function ping(user: string, url: string, secret: string): Promise<string | undefined> {
    try {
      return (await call(url, secret, { op: 'ping', calendar: await targetOf(user) })).calendar;
    } catch (error) {
      if (error instanceof SyncError) throw new ActionInputError(error.message);
      throw error;
    }
  }

  async function syncNow(user: string, timeZone: string): Promise<number | undefined> {
    if ((await pendingCount(user)) === undefined) return undefined;
    lastTry.set(user, now());
    const task = sync(user, timeZone);
    task.catch((error: unknown) => report(user, error));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SYNC_BUDGET_MS);
    });
    await Promise.race([task.catch(() => undefined), budget]);
    clearTimeout(timer);
    return pendingCount(user);
  }

  /** 试连通过：记下日历名，补推 */
  async function connected(user: string, config: SyncConfig, timeZone: string): Promise<SyncSettings> {
    await store.put(user, config);
    lastError.delete(user);
    await syncNow(user, timeZone);
    return settingsOf(user, config);
  }

  return {
    async readSyncSettings(user) {
      if (user === ANONYMOUS) return { connected: false, script: undefined };
      return settingsOf(user, await store.get(user));
    },
    async prepareSync(user) {
      requireUser(user);
      const existing = await store.get(user);
      if (existing) return settingsOf(user, existing);
      const config = { secret: newSecret() };
      await store.put(user, config);
      return settingsOf(user, config);
    },
    async connectSync(user, input, timeZone) {
      requireUser(user);
      const url = normalizeScriptUrl(input);
      if (!url) throw new ActionInputError('请粘贴部署后得到的网页应用地址：https://script.google.com/macros/s/…/exec');
      const config = await store.get(user);
      if (!config) throw new ActionInputError('请先点「开始连接」，复制脚本并部署');
      const calendarName = await ping(user, url, config.secret);
      // 连上之前添加的日程也推过去
      return connected(user, { secret: config.secret, url, ...(calendarName ? { calendarName } : {}) }, timeZone);
    },
    async checkSync(user, timeZone) {
      requireUser(user);
      const config = await store.get(user);
      if (!config?.url) throw new ActionInputError('还没有连接 Google 日历');
      const calendarName = await ping(user, config.url, config.secret);
      return connected(user, { secret: config.secret, url: config.url, ...(calendarName ? { calendarName } : {}) }, timeZone);
    },
    async disconnectSync(user) {
      requireUser(user);
      const config = await store.get(user);
      if (config) await store.put(user, { secret: config.secret });
      lastError.delete(user);
      return settingsOf(user, config && { secret: config.secret });
    },
    pendingCount,
    lastSyncError: (user) => lastError.get(user),
    syncNow,
    syncSoon(user, timeZone) {
      const last = lastTry.get(user);
      if (last !== undefined && now() - last < RETRY_EVERY_MS) return;
      lastTry.set(user, now());
      void pendingCount(user)
        .then((count) => (count ? sync(user, timeZone) : undefined))
        .catch((error: unknown) => report(user, error));
    },
  };
}

const defaultSync = createGoogleSync();

export const {
  readSyncSettings,
  prepareSync,
  connectSync,
  checkSync,
  disconnectSync,
  pendingCount,
  lastSyncError,
  syncNow,
  syncSoon,
} = defaultSync;
