/**
 * 日历服务：读用户的订阅地址 → 抓取 ICS → 解析 → 按请求的日期范围展开。
 * 每个用户一个缓存，缓存的是解析结果，不同范围的请求各自展开：
 *   新鲜期 120 秒；过期后先返回旧数据、后台刷新（并发请求合并成一次抓取）；
 *   后台刷新失败时继续用旧数据，stale: true，最多 24 小时；抓取失败不缓存，下次请求重新抓。
 *   解析失败例外：同一份坏文件每次都会失败，而解析是同步的、最多占满 4 秒 CPU，120 秒内直接重放同一个错误。
 * 订阅地址等同于访问凭据：日志和返回值里只出现主机名，地址本身不离开服务端。
 * 用户自己添加的日程（local-events）和订阅里的合在一起返回：没有订阅的登录用户也是 ok，只有自己的日程；
 * 自己的日程推到 Google 后订阅里会再出现一次（同一 UID），订阅里的那份不显示
 */
import { ANONYMOUS } from '../../core/api';
import { createCache, type Cache } from '../../core/cache';
import { UpstreamError } from '../../core/http';
import { logBackgroundError } from '../../core/log';
import { ActionInputError } from '../../core/widget';
import { canonicalTimeZone, diffDays, isDateKey } from '../../lib/zoned-time';
import type { DateRange } from './days';
import { DEFAULT_LIMITS, expandFeed, type ExpandLimits, type Expansion } from './expand';
import { CalendarFetchError, fetchIcs } from './fetch-ics';
import { defaultLocalEvents, eventsInRange, hiddenByOwn, type LocalEventsService } from './local-events';
import type { CalendarFeed, CalendarSettings } from './model';
import { CalendarParseError, parseFeed, type ParsedFeed } from './parse';
import { createCalendarStore, type CalendarStore } from './store';
import { checkUrl, type LookupFn } from './url-guard';

export type { DateRange };

export interface EventsOptions {
  /** 站点时区（site.timezone），决定“哪一天”和全天日程的边界 */
  readonly timeZone: string;
  /**
   * 开始前和展开日程前各检查一次：已取消的请求不读存储、不发起抓取，也不再展开重复日程。
   * 抓取由多个请求共用，开始后不会因为某个请求取消而中断，这次等待也不会提前结束；抓到的照常进缓存
   */
  readonly signal?: AbortSignal;
}

export interface CalendarService {
  getCalendarEvents(user: string, range: DateRange, options: EventsOptions): Promise<CalendarFeed>;
  readCalendarSettings(user: string): Promise<CalendarSettings>;
  /** 地址不合格时抛 ActionInputError（中文说明）；成功后该用户的缓存作废 */
  saveCalendarUrl(user: string, url: string): Promise<CalendarSettings>;
  clearCalendarUrl(user: string): Promise<CalendarSettings>;
}

export interface CalendarServiceDeps {
  readonly store?: CalendarStore;
  /** 用户自己添加的日程 */
  readonly local?: LocalEventsService;
  /** 测试时注入，不碰真实网络 */
  readonly fetch?: typeof fetch;
  readonly lookup?: LookupFn;
  /** 缓存用的单调时钟 */
  readonly now?: () => number;
  /** fetchedAt 用的系统时间 */
  readonly clock?: () => number;
  /** 展开 RRULE 的上限；测试时调小，不必真的跑到时间预算 */
  readonly limits?: ExpandLimits;
}

const FRESH_MS = 120_000;
const STALE_MS = 24 * 3_600_000;
/** 解析失败后多久再试：与新鲜期相同，订阅源修好文件后最多晚两分钟看到 */
const PARSE_RETRY_MS = FRESH_MS;
/** 一次最多展开的天数：月视图、议程、倒数日都远用不到 */
export const MAX_RANGE_DAYS = 800;
const MIN_KEY = '1900-01-01';
const MAX_KEY = '2201-01-01';
/** 每份解析结果记住的展开结果数：日历和议程常常请求同一范围 */
const MAX_EXPANSIONS = 8;

const NOT_CONFIGURED: CalendarSettings = Object.freeze({ configured: false });
const UNCONFIGURED_FEED: CalendarFeed = Object.freeze({ status: 'unconfigured' });

interface Loaded {
  readonly feed: ParsedFeed;
  readonly fetchedAt: number;
}

interface SlotState {
  /** 最近一次后台刷新失败、正在用旧数据 */
  failed: boolean;
  /** 最近一次解析失败和它发生的时间（单调时钟）；PARSE_RETRY_MS 内不再抓取、不再解析 */
  parseFailure: { readonly error: CalendarParseError; readonly at: number } | undefined;
}

/** 一个用户当前订阅地址的缓存；地址变了就换一个新的 */
interface Slot {
  readonly url: string;
  readonly host: string;
  readonly cache: Cache<Loaded>;
  readonly state: SlotState;
  /** 已经记过日志的数据问题，同一个地址每种只记一次 */
  readonly reported: Set<string>;
}

/** 日志里的地址：只留主机名 */
const redacted = (host: string) => `${host}/…redacted`;

/** 写进日志的失败原因：只用不含地址的字段 */
function causeOf(error: unknown): string {
  if (error instanceof CalendarFetchError) {
    const extra = [error.reason, error.status, error.detail].filter((part) => part !== undefined).join(' ');
    return `${error.message}（${extra}）`;
  }
  if (error instanceof CalendarParseError) return `${error.message}（${error.causeName ?? 'parse'}）`;
  return error instanceof Error ? error.name : typeof error;
}

function checkRange({ from, to }: DateRange): void {
  if (!isDateKey(from) || !isDateKey(to)) throw new ActionInputError('日期范围无效，格式为 YYYY-MM-DD');
  if (from < MIN_KEY || to > MAX_KEY) throw new ActionInputError('日期范围只支持 1900 至 2200 年');
  const days = diffDays(from, to);
  if (days <= 0) throw new ActionInputError('结束日期必须晚于开始日期');
  if (days > MAX_RANGE_DAYS) throw new ActionInputError(`日期范围最多 ${MAX_RANGE_DAYS} 天`);
}

/** site.yaml 已校验过时区；到这里还无效说明是调用方的错误，不是用户输入的问题 */
function zoneOf(timeZone: string): string {
  const zone = canonicalTimeZone(timeZone);
  if (!zone) throw new RangeError('无效的时区');
  return zone;
}

function requireUser(user: string): void {
  if (user === ANONYMOUS) throw new ActionInputError('未登录，无法保存日历设置');
}

/** 数据本身的问题每刷新一次都会再出现，同一个地址每种只记一次 */
function reportOnce(slot: Slot, kind: string, user: string, message: string): void {
  if (slot.reported.has(kind)) return;
  slot.reported.add(kind);
  logBackgroundError('calendar', `${user} 的日历（${redacted(slot.host)}）`, message);
}

type Loader = (url: string) => Promise<ParsedFeed>;

interface Clocks {
  /** 单调时钟：缓存和解析失败的重试间隔 */
  readonly now: () => number;
  /** 系统时间：fetchedAt */
  readonly clock: () => number;
}

async function loadInto(slot: Slot, user: string, load: Loader, { now, clock }: Clocks): Promise<Loaded> {
  const recent = slot.state.parseFailure;
  // 已经记过日志，重放时不再记
  if (recent && now() - recent.at < PARSE_RETRY_MS) throw recent.error;
  try {
    const feed = await load(slot.url);
    slot.state.failed = false;
    slot.state.parseFailure = undefined;
    if (feed.skipped > 0) reportOnce(slot, 'skipped', user, `有 ${feed.skipped} 个条目读不懂，已跳过`);
    return { feed, fetchedAt: clock() };
  } catch (error) {
    if (error instanceof CalendarParseError) slot.state.parseFailure = { error, at: now() };
    logBackgroundError('calendar', `${user} 的日历（${redacted(slot.host)}）加载失败`, causeOf(error));
    throw error;
  }
}

// 解析结果 → 展开结果；解析结果被缓存替换后连同展开结果一起回收
const expansions = new WeakMap<ParsedFeed, Map<string, Expansion>>();

function expandMemo(feed: ParsedFeed, range: DateRange, timeZone: string, limits: ExpandLimits): Expansion {
  const key = `${timeZone}|${range.from}|${range.to}`;
  const memo = expansions.get(feed) ?? new Map<string, Expansion>();
  expansions.set(feed, memo);
  const hit = memo.get(key);
  if (hit) return hit;
  const expansion = expandFeed(feed, { from: range.from, to: range.to, timeZone }, limits);
  memo.set(key, expansion);
  if (memo.size > MAX_EXPANSIONS) memo.delete(memo.keys().next().value!);
  return expansion;
}

function reportIssues(slot: Slot, user: string, { issues }: Expansion): void {
  if (issues.timeout > 0) reportOnce(slot, 'timeout', user, `有 ${issues.timeout} 个重复日程展开超时，已跳过`);
  if (issues.invalid > 0) reportOnce(slot, 'invalid', user, `有 ${issues.invalid} 个日程展开出错，已跳过`);
  if (issues.truncated) reportOnce(slot, 'truncated', user, '日程太多，只显示了一部分');
}

function createSlot(url: string, now: () => number): Slot {
  const state: SlotState = { failed: false, parseFailure: undefined };
  const cache = createCache<Loaded>({
    ttlMs: FRESH_MS,
    maxEntries: 1,
    now,
    // 失败原因已在 loadInto 里记过，这里只标记正在用旧数据
    stale: {
      ms: STALE_MS,
      onError: () => {
        state.failed = true;
      },
    },
  });
  return { url, host: new URL(url).host, cache, state, reported: new Set() };
}

export function createCalendarService(deps: CalendarServiceDeps = {}): CalendarService {
  const {
    store = createCalendarStore(),
    local = defaultLocalEvents,
    lookup,
    now = () => performance.now(),
    clock = Date.now,
    limits = DEFAULT_LIMITS,
  } = deps;
  const clocks: Clocks = { now, clock };
  const load: Loader = async (url) => parseFeed(await fetchIcs(url, { fetch: deps.fetch, lookup }));
  // 用户 → 当前地址的缓存。地址变了（保存、清除或手改文件）就换一个新的，旧数据不会混进来
  const slots = new Map<string, Slot>();

  function slotFor(user: string, url: string): Slot {
    const existing = slots.get(user);
    if (existing?.url === url) return existing;
    const slot = createSlot(url, now);
    slots.set(user, slot);
    return slot;
  }

  async function getCalendarEvents(user: string, range: DateRange, options: EventsOptions): Promise<CalendarFeed> {
    checkRange(range);
    const timeZone = zoneOf(options.timeZone);
    options.signal?.throwIfAborted();
    if (user === ANONYMOUS) return UNCONFIGURED_FEED;
    const [url, records] = await Promise.all([store.get(user), local.records(user)]);
    const mine = eventsInRange(
      records.filter((event) => !event.deleted),
      range,
      timeZone,
    );
    if (!url) return { status: 'ok', events: mine, stale: false, fetchedAt: clock() };
    const slot = slotFor(user, url);
    let loaded: Loaded;
    try {
      loaded = await slot.cache.get('feed', () => loadInto(slot, user, load, clocks));
    } catch (error) {
      // 抓取、解析失败：消息是不含地址的中文说明，直接显示在日历里
      if (error instanceof UpstreamError) return { status: 'error', message: error.message };
      throw error;
    }
    // 等抓取的时候浏览器已经翻到了别的月份：展开 RRULE 是这里最费 CPU 的一步，没人要就不做
    options.signal?.throwIfAborted();
    const expansion = expandMemo(loaded.feed, range, timeZone, limits);
    reportIssues(slot, user, expansion);
    // 推到 Google 的日程订阅里也有一份（含已删、订阅还没跟上的）：只显示这边的
    const hidden = hiddenByOwn(records);
    const events = records.length > 0 ? [...expansion.events.filter((event) => !hidden(event.id)), ...mine] : expansion.events;
    return { status: 'ok', events, stale: slot.state.failed, fetchedAt: loaded.fetchedAt };
  }

  return {
    getCalendarEvents,
    async readCalendarSettings(user) {
      const url = user === ANONYMOUS ? undefined : await store.get(user);
      return url ? { configured: true, host: new URL(url).host } : NOT_CONFIGURED;
    },
    async saveCalendarUrl(user, url) {
      requireUser(user);
      // 保存时就做完整检查（含 DNS），填错马上提示，而不是等到下次抓取
      const check = await checkUrl(url, { lookup });
      if (!check.ok) throw new ActionInputError(check.message);
      await store.put(user, check.url.href);
      slots.delete(user);
      return { configured: true, host: check.url.host };
    },
    async clearCalendarUrl(user) {
      requireUser(user);
      await store.put(user, undefined);
      slots.delete(user);
      return NOT_CONFIGURED;
    },
  };
}

const defaultService = createCalendarService();

export const { getCalendarEvents, readCalendarSettings, saveCalendarUrl, clearCalendarUrl } = defaultService;
