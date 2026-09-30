/**
 * ICS 文本 → 与查询窗口无关的中间结构，服务层缓存它，每次请求再按窗口展开（expand.ts）。
 * 时区：优先用订阅自带的 VTIMEZONE；TZID 没有定义、或是浮动时间，则记成「墙上时间」，
 * 展开时按 IANA 名或站点时区换算，从不依赖服务器所在时区。
 * 整段解析放在时间预算里跑，畸形文件卡不死进程。
 */
import ICAL from 'ical.js';
import { UpstreamError } from '../../core/http';
import { canonicalTimeZone, formatDateKey } from '../../lib/zoned-time';
import { normalizeLocation, normalizeTitle } from './model';
import { runWithBudget, TimeBudgetExceeded } from './time-budget';

/** 一个时间点在 ICS 里的三种写法 */
export type TimeSpec =
  | { readonly kind: 'date'; readonly key: string }
  | { readonly kind: 'instant'; readonly ms: number }
  | {
      readonly kind: 'wall';
      readonly year: number;
      readonly month: number;
      readonly day: number;
      readonly hour: number;
      readonly minute: number;
      readonly second: number;
      /** IANA 名；undefined 表示浮动时间，展开时用站点时区 */
      readonly zone: string | undefined;
    };

/** 单次日程，或重复日程里被单独改过的那一次 */
export interface EventRecord {
  readonly uid: string;
  /** 被改的那一次原本的时间（RECURRENCE-ID），用来生成稳定的 id */
  readonly rid: TimeSpec | undefined;
  readonly title: string;
  readonly location: string | undefined;
  readonly start: TimeSpec;
  readonly end: TimeSpec;
}

/** 重复日程的一个内容来源：主日程本身，或 THISANDFUTURE 例外 */
export interface SeriesItem {
  readonly title: string;
  readonly location: string | undefined;
  readonly cancelled: boolean;
  /** 这一来源 DTSTART 的 TZID 解析结果，浮动/墙上时间按它换算 */
  readonly zone: string | undefined;
}

export interface SeriesRecord {
  readonly uid: string;
  /** 已关联 THISANDFUTURE 例外的 ical.js 事件（精简副本，见 detached），只在展开时使用 */
  readonly event: ICAL.Event;
  /** getOccurrenceDetails 返回的 item（主日程或 THISANDFUTURE 例外）→ 它的内容 */
  readonly items: ReadonlyMap<ICAL.Event, SeriesItem>;
  /** 被单独改过或取消的那几次（RECURRENCE-ID）：展开时跳过，改过的由 singles 里的记录代替 */
  readonly overridden: readonly TimeSpec[];
  /** 任何一次的开始/结束离它原本的时间最远能偏多少毫秒，展开时用来粗筛 */
  readonly reachMs: number;
}

export interface ParsedFeed {
  readonly singles: readonly EventRecord[];
  readonly series: readonly SeriesRecord[];
  /** 读不懂、被跳过的条目数（含被丢弃的畸形重复规则、超出上限的日程） */
  readonly skipped: number;
}

const MAX_EVENTS = 20_000;
const PARSE_BUDGET_MS = 4000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const MAX_UID = 200;
const MAX_TZID = 100;
const MAX_OBSERVANCES = 200;
const MAX_ZONE_RDATES = 1000;
const FORMAT_ERROR = '日历文件格式有误';
const TIMEOUT_ERROR = '日历文件太复杂，解析超时';

/** 整份文件读不懂。消息给用户看；原始异常只留类名，它的消息可能夹带日历内容 */
export class CalendarParseError extends UpstreamError {
  constructor(
    message: string,
    readonly causeName?: string,
  ) {
    super(message);
    this.name = 'CalendarParseError';
  }
}

// 折行：换行后跟一个空格或制表符
const FOLD = /\r?\n[ \t]/g;
// 一行 RRULE/EXRULE：名字、参数、值。参数里带引号冒号的罕见写法会被当成畸形，后果只是这条规则失效
const RULE_LINE = /^((?:[A-Za-z0-9-]+\.)?(?:RRULE|EXRULE))((?:;[^:\r\n]*)?):([^\r\n]*)$/gim;

/**
 * ical.js 解析时就校验重复规则，一条写坏整份文件都读不出来。
 * 先把读不懂的规则改名成 X- 属性（会被忽略），那条日程退化成只有第一次。
 */
function stripInvalidRules(text: string): { readonly text: string; readonly dropped: number } {
  let dropped = 0;
  const cleaned = text.replace(FOLD, '').replace(RULE_LINE, (line: string, name: string, params: string, value: string) => {
    try {
      ICAL.Recur.fromString(value);
      return line;
    } catch {
      dropped += 1;
      return `X-INVALID-${name.replace('.', '-')}${params}:${value}`;
    }
  });
  return { text: cleaned, dropped };
}

type RecurParts = Readonly<Record<string, readonly (number | string)[] | undefined>>;

function partsOf(rule: ICAL.Recur): RecurParts {
  return rule.parts as RecurParts;
}

// 每个月最多几天（二月按闰年算）
const MONTH_MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * 规则要的「几号」在它限定的每个月里都不存在（如 BYMONTH=2;BYMONTHDAY=30）。
 * ical.js 会为这种规则一直找下去，所以提前认出来，不去展开。
 */
export function impossibleMonthDays(rule: ICAL.Recur): boolean {
  const parts = partsOf(rule);
  const months = (parts.BYMONTH ?? []).map(Number);
  const days = (parts.BYMONTHDAY ?? []).map(Number);
  if (months.length === 0 || days.length === 0) return false;
  const longest = Math.max(...months.map((month) => MONTH_MAX_DAYS[month - 1] ?? 31));
  return days.every((day) => Math.abs(day) > longest);
}

function hasImpossibleRule(component: ICAL.Component): boolean {
  return component.getAllProperties('rrule').some((prop) => {
    const rule = prop.getFirstValue();
    return rule instanceof ICAL.Recur && impossibleMonthDays(rule);
  });
}

// VTIMEZONE 只该有「每年某月第几个星期几 / 某几号」这类规则，其余一律不信任
const ZONE_RULE_PARTS = new Set(['BYMONTH', 'BYDAY', 'BYMONTHDAY']);
const ZONE_WEEKDAY = /^(?:[+-]?[1-5])?(?:SU|MO|TU|WE|TH|FR|SA)$/;
const OBSERVANCES = new Set(['standard', 'daylight']);

function safeZoneRule(rule: unknown): boolean {
  if (!(rule instanceof ICAL.Recur) || rule.freq !== 'YEARLY') return false;
  const parts = partsOf(rule);
  const known = Object.keys(parts).every((key) => ZONE_RULE_PARTS.has(key));
  const weekdays = (parts.BYDAY ?? []).every((day) => ZONE_WEEKDAY.test(String(day)));
  return known && weekdays && !impossibleMonthDays(rule);
}

/** 不像正常时区定义的 VTIMEZONE 整个丢掉：引用它的时间退回按 TZID 名字或站点时区换算 */
function safeZone(zone: ICAL.Component): boolean {
  const tzid = zone.getFirstPropertyValue('tzid');
  if (typeof tzid !== 'string' || tzid.length === 0 || tzid.length > MAX_TZID) return false;
  const observances = zone.getAllSubcomponents();
  if (observances.length === 0 || observances.length > MAX_OBSERVANCES) return false;
  let rdates = 0;
  for (const observance of observances) {
    if (!OBSERVANCES.has(observance.name)) return false;
    if (!observance.getAllProperties('rrule').every((prop) => safeZoneRule(prop.getFirstValue()))) return false;
    rdates += observance.getAllProperties('rdate').length;
  }
  return rdates <= MAX_ZONE_RDATES;
}

/** TZID → IANA 名；认不出返回 undefined（按站点时区算） */
type ZoneResolver = (tzid: unknown) => string | undefined;

function createZoneResolver(): ZoneResolver {
  const cache = new Map<string, string | undefined>();
  return (raw) => {
    const tzid = Array.isArray(raw) ? raw[0] : raw;
    if (typeof tzid !== 'string' || tzid.length === 0 || tzid.length > MAX_TZID) return undefined;
    if (cache.has(tzid)) return cache.get(tzid);
    // 有些软件给名字加前缀，如 /mozilla.org/20050126_1/Europe/Madrid：逐段去掉再试
    const segments = tzid.split('/');
    let zone: string | undefined;
    for (let i = 0; i < segments.length && zone === undefined; i++) {
      const candidate = segments.slice(i).join('/');
      if (candidate) zone = canonicalTimeZone(candidate);
    }
    cache.set(tzid, zone);
    return zone;
  };
}

function tzidOf(prop: ICAL.Property | null): unknown {
  return prop?.getParameter('tzid');
}

/** ical.js 的时间 → TimeSpec；年份离谱（常见于写坏的文件）返回 undefined */
export function specOf(time: ICAL.Time, zone: string | undefined): TimeSpec | undefined {
  if (!Number.isInteger(time.year) || time.year < MIN_YEAR || time.year > MAX_YEAR) return undefined;
  if (time.isDate) return { kind: 'date', key: formatDateKey(time) };
  const floating = !time.zone || time.zone === ICAL.Timezone.localTimezone;
  if (!floating) return { kind: 'instant', ms: Math.round(time.toUnixTime() * 1000) };
  const { year, month, day, hour, minute, second } = time;
  return { kind: 'wall', year, month, day, hour, minute, second, zone };
}

/** 墙上时间当 UTC 算的毫秒数：只用来粗筛，误差在一天以内 */
export function roughMs(time: ICAL.Time): number {
  return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
}

function uidOf(component: ICAL.Component, index: number): string {
  const value = component.getFirstPropertyValue('uid');
  const uid = typeof value === 'string' ? value.trim() : '';
  return (uid || `(no-uid-${index})`).slice(0, MAX_UID);
}

function isCancelled(component: ICAL.Component): boolean {
  const status = component.getFirstPropertyValue('status');
  return typeof status === 'string' && status.trim().toUpperCase() === 'CANCELLED';
}

/** 不能用 new ICAL.Event(comp)：它会把整份文件里同 UID 的例外自动关联上来 */
function eventOf(component: ICAL.Component): ICAL.Event {
  return new ICAL.Event(component, { exceptions: [] });
}

function ridOf(event: ICAL.Event, zones: ZoneResolver): TimeSpec | undefined {
  const prop = event.component.getFirstProperty('recurrence-id');
  return prop ? specOf(event.recurrenceId, zones(tzidOf(prop))) : undefined;
}

/** 单次日程或单独改过的那一次 → EventRecord；开始时间离谱返回 undefined */
function recordOf(event: ICAL.Event, uid: string, zones: ZoneResolver): EventRecord | undefined {
  const component = event.component;
  const startZone = zones(tzidOf(component.getFirstProperty('dtstart')));
  const start = specOf(event.startDate, startZone);
  if (!start) return undefined;
  // 没有 DTEND 时 ical.js 用 DURATION 或默认时长推出结束，时区与开始相同
  const endProp = component.getFirstProperty('dtend');
  const endSpec = specOf(event.endDate, endProp ? zones(tzidOf(endProp)) : startZone);
  // 结束离谱、或与开始类型对不上（全天配定时）：当作没写，展开时按默认时长
  const end = endSpec && (endSpec.kind === 'date') === (start.kind === 'date') ? endSpec : start;
  return {
    uid,
    rid: ridOf(event, zones),
    title: normalizeTitle(event.summary),
    location: normalizeLocation(event.location),
    start,
    end,
  };
}

/** 重复日程 → SeriesRecord；THISANDFUTURE 例外须已关联到 event 上 */
function seriesOf(event: ICAL.Event, uid: string, overridden: readonly TimeSpec[], zones: ZoneResolver): SeriesRecord {
  // ical.js 把 exceptions 声明成数组，实际是按 RECURRENCE-ID 索引的对象
  const related = Object.values(event.exceptions as unknown as Record<string, ICAL.Event>);
  const items = new Map<ICAL.Event, SeriesItem>();
  let reachMs = 0;
  for (const source of [event, ...related]) {
    const component = source.component;
    items.set(source, {
      title: normalizeTitle(source.summary),
      location: normalizeLocation(source.location),
      cancelled: isCancelled(component),
      zone: zones(tzidOf(component.getFirstProperty('dtstart'))),
    });
    const start = roughMs(source.startDate);
    const shift = source === event ? 0 : Math.abs(start - roughMs(source.recurrenceId));
    reachMs = Math.max(reachMs, shift + Math.max(0, roughMs(source.endDate) - start));
  }
  return { uid, event, items, overridden: Object.freeze([...overridden]), reachMs };
}

/** 分拣过程中的临时容器，只在 buildFeed 内部使用 */
interface Buckets {
  readonly singles: EventRecord[];
  readonly masters: Map<string, ICAL.Event[]>;
  readonly exceptions: Map<string, ICAL.Event[]>;
  readonly overridden: Map<string, TimeSpec[]>;
  skipped: number;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function addRecord(buckets: Buckets, event: ICAL.Event, uid: string, zones: ZoneResolver): void {
  const record = recordOf(event, uid, zones);
  if (record) buckets.singles.push(record);
  else buckets.skipped += 1;
}

/** 把每个 VEVENT 分成：单次日程、重复日程的主日程、单独改过的某一次 */
function classify(components: readonly ICAL.Component[], zones: ZoneResolver): Buckets {
  const buckets: Buckets = { singles: [], masters: new Map(), exceptions: new Map(), overridden: new Map(), skipped: 0 };
  components.forEach((component, index) => {
    try {
      if (!component.hasProperty('dtstart')) {
        buckets.skipped += 1;
        return;
      }
      const event = eventOf(component);
      const uid = uidOf(component, index);
      if (event.isRecurrenceException()) push(buckets.exceptions, uid, event);
      // 规则自相矛盾的重复日程只剩 DTSTART 那一次，与 ical.js 的行为一致
      else if (event.isRecurring() && !hasImpossibleRule(component)) push(buckets.masters, uid, event);
      else if (!isCancelled(component)) addRecord(buckets, event, uid, zones);
    } catch {
      buckets.skipped += 1;
    }
  });
  return buckets;
}

/**
 * 单独改过/取消的那一次：主日程展开时跳过它原本的时间，改过的作为独立记录输出。
 * THISANDFUTURE 还要关联到主日程上，之后每一次都用它的内容和时间偏移。找不到主日程的照样独立输出。
 */
function applyException(buckets: Buckets, exception: ICAL.Event, uid: string, zones: ZoneResolver): void {
  const masters = buckets.masters.get(uid);
  if (masters) {
    const rid = ridOf(exception, zones);
    if (rid) push(buckets.overridden, uid, rid);
    if (exception.modifiesFuture()) masters.forEach((master) => master.relateException(exception));
  }
  if (!isCancelled(exception.component)) addRecord(buckets, exception, uid, zones);
}

function applyExceptions(buckets: Buckets, zones: ZoneResolver): void {
  for (const [uid, list] of buckets.exceptions) {
    for (const exception of list) {
      try {
        applyException(buckets, exception, uid, zones);
      } catch {
        buckets.skipped += 1;
      }
    }
  }
}

/**
 * 分拣和展开会读到的属性，其余（描述、参与人、提醒等）不带进缓存。
 * X-INVALID-* 是 stripInvalidRules 改名后的坏规则，留着它们不影响展开，只是不值得保存
 */
const KEPT_PROPERTIES = new Set([
  'uid',
  'summary',
  'location',
  'status',
  'dtstart',
  'dtend',
  'duration',
  'rrule',
  'exrule',
  'rdate',
  'exdate',
  'recurrence-id',
]);

/**
 * VEVENT 的精简副本，挂在只含时区定义的日历下：重复日程要把 ical.js 对象留在缓存里展开，
 * 挂在原来的日历下，它就通过 parent 拖着整份文件的 jCal 和其余日程（实测 5 MB 的文件留下 50 MB 以上）。
 * 属性数组与原文件共用，只是不再被整棵树引用
 */
function detached(vevent: ICAL.Component, zones: ICAL.Component): ICAL.Component {
  const [name, properties] = vevent.jCal as [string, unknown[][]];
  const kept = properties.filter((prop) => KEPT_PROPERTIES.has(String(prop[0])));
  return new ICAL.Component([name, kept, []], zones);
}

/** 解析文本、取出全部 VEVENT。VTIMEZONE 必须在访问任何日程时间之前消毒：ical.js 首次查找后就缓存时区 */
function collectComponents(text: string, maxEvents: number): { readonly components: ICAL.Component[]; readonly overflow: number } {
  const jcal: unknown = ICAL.parse(text);
  if (!Array.isArray(jcal)) throw new CalendarParseError(FORMAT_ERROR, 'NotCalendar');
  // 只有一个根组件时 parse 直接返回它，多个时返回数组
  const roots: unknown[] = typeof jcal[0] === 'string' ? [jcal] : jcal;
  const components: ICAL.Component[] = [];
  let overflow = 0;
  for (const data of roots) {
    if (!Array.isArray(data)) continue;
    const root = new ICAL.Component(data);
    if (root.name !== 'vcalendar') continue;
    // 每个 VCALENDAR 各自的时区定义：日程的 TZID 只在自己所在的日历里查
    const safeZones = root.getAllSubcomponents('vtimezone').filter(safeZone);
    const zones = new ICAL.Component(['vcalendar', [], safeZones.map((zone) => zone.jCal)]);
    for (const vevent of root.getAllSubcomponents('vevent')) {
      if (components.length < maxEvents) components.push(detached(vevent, zones));
      else overflow += 1;
    }
  }
  return { components, overflow };
}

function buildFeed(raw: string, maxEvents: number): ParsedFeed {
  const { text, dropped } = stripInvalidRules(raw);
  const { components, overflow } = collectComponents(text, maxEvents);
  const zones = createZoneResolver();
  const buckets = classify(components, zones);
  applyExceptions(buckets, zones);
  const series: SeriesRecord[] = [];
  for (const [uid, masters] of buckets.masters) {
    for (const master of masters) {
      try {
        const record = seriesOf(master, uid, buckets.overridden.get(uid) ?? [], zones);
        // 整个系列都取消了，不必展开
        if ([...record.items.values()].some((item) => !item.cancelled)) series.push(record);
      } catch {
        buckets.skipped += 1;
      }
    }
  }
  return Object.freeze({
    singles: Object.freeze(buckets.singles),
    series: Object.freeze(series),
    skipped: buckets.skipped + dropped + overflow,
  });
}

export interface ParseOptions {
  /** 整份解析的时间上限（毫秒） */
  readonly budgetMs?: number;
  readonly maxEvents?: number;
}

/** 解析 ICS 文本（同步）。个别读不懂的日程跳过并计数；整份读不懂或超时抛 CalendarParseError */
export function parseFeed(text: string, options: ParseOptions = {}): ParsedFeed {
  const { budgetMs = PARSE_BUDGET_MS, maxEvents = MAX_EVENTS } = options;
  try {
    return runWithBudget(budgetMs, () => buildFeed(text, maxEvents));
  } catch (error) {
    if (error instanceof CalendarParseError) throw error;
    if (error instanceof TimeBudgetExceeded) throw new CalendarParseError(TIMEOUT_ERROR, error.name);
    throw new CalendarParseError(FORMAT_ERROR, error instanceof Error ? error.name : typeof error);
  }
}
