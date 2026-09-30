/**
 * 把 ParsedFeed 按查询窗口展开成 CalendarEvent。窗口是站点时区的日期键 [from, to)。
 * 重复日程由 ical.js 从 DTSTART 起逐次迭代（约 10 微秒一步），每个系列单独限时、限步数、限条数；
 * 超时或出错的系列在这份解析结果的有效期内不再展开。
 */
import type ICAL from 'ical.js';
import { addDays, parseDateKey, startOfDayMs, zonedWallTimeToMs } from '../../lib/zoned-time';
import type { CalendarEvent } from './model';
import { roughMs, specOf, type EventRecord, type ParsedFeed, type SeriesRecord, type TimeSpec } from './parse';
import { runWithBudget, TimeBudgetExceeded } from './time-budget';

export interface ExpandWindow {
  /** 含，站点时区的日期键 */
  readonly from: string;
  /** 不含 */
  readonly to: string;
  /** 站点时区（IANA 名）：全天日程、浮动时间都按它算 */
  readonly timeZone: string;
}

export interface ExpandLimits {
  /** 单个重复系列的时间上限（毫秒） */
  readonly seriesBudgetMs: number;
  /** 一次展开里所有系列加起来的时间上限 */
  readonly totalBudgetMs: number;
  readonly maxStepsPerSeries: number;
  readonly maxSteps: number;
  readonly maxEventsPerSeries: number;
  readonly maxEvents: number;
}

export const DEFAULT_LIMITS: ExpandLimits = Object.freeze({
  seriesBudgetMs: 500,
  totalBudgetMs: 2000,
  maxStepsPerSeries: 100_000,
  maxSteps: 400_000,
  maxEventsPerSeries: 2000,
  maxEvents: 10_000,
});

export interface ExpandIssues {
  /** 这次超时的系列数 */
  readonly timeout: number;
  /** 出错、或之前已超时而被跳过的系列数 */
  readonly invalid: number;
  /** 碰到了步数、条数或总时间上限，结果可能不全 */
  readonly truncated: boolean;
}

export interface Expansion {
  readonly events: readonly CalendarEvent[];
  readonly issues: ExpandIssues;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// 粗筛把墙上时间当 UTC 算，各时区偏差最多约 ±14 小时；再加上 DTSTART/DTEND 时区不同带来的时长误差
const SLACK_MS = 3 * DAY_MS;

// 超时或出错的系列：同一份解析结果不再展开，缓存刷新后自然重试
const poisoned = new WeakSet<SeriesRecord>();

interface Context {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly fromMs: number;
  readonly toMs: number;
  readonly fromRough: number;
  readonly toRough: number;
  readonly limits: ExpandLimits;
}

interface Tally {
  steps: number;
  timeout: number;
  invalid: number;
  truncated: boolean;
}

interface Draft {
  readonly event: CalendarEvent;
  /** 排序用：全天日程取站点时区当天零点 */
  readonly sortMs: number;
}

/** 一条日程除起止时间外的身份和内容 */
interface Source {
  readonly uid: string;
  readonly rid: TimeSpec | undefined;
  readonly title: string;
  readonly location: string | undefined;
}

function wallToMs(spec: Extract<TimeSpec, { kind: 'wall' }>, timeZone: string): number {
  return zonedWallTimeToMs(spec.year, spec.month, spec.day, spec.hour, spec.minute, spec.second, spec.zone ?? timeZone);
}

/** TimeSpec → UTC 毫秒；全天取站点时区当天零点 */
function exactMs(spec: TimeSpec, timeZone: string): number {
  if (spec.kind === 'instant') return spec.ms;
  if (spec.kind === 'wall') return wallToMs(spec, timeZone);
  return startOfDayMs(spec.key, timeZone);
}

/** 粗略毫秒数（墙上时间当 UTC），与 roughMs 同一口径 */
function approxMs(spec: TimeSpec): number {
  if (spec.kind === 'instant') return spec.ms;
  if (spec.kind === 'wall') return Date.UTC(spec.year, spec.month - 1, spec.day, spec.hour, spec.minute, spec.second);
  const parts = parseDateKey(spec.key);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) : Number.NaN;
}

/** 同一时刻不论写法都得到同一个键：用来匹配 RECURRENCE-ID，也用来拼 id */
function keyOf(spec: TimeSpec, timeZone: string): string {
  return spec.kind === 'date' ? spec.key : new Date(exactMs(spec, timeZone)).toISOString();
}

/** id：UID + 这一次原本的时间，改过的那一次与它替换掉的那次同 id */
function idOf(source: Source, start: TimeSpec, timeZone: string): string {
  return `${source.uid}@${keyOf(source.rid ?? start, timeZone)}`;
}

/** 算出这一次的最终形状；与窗口不相交返回 undefined */
function draftOf(ctx: Context, source: Source, start: TimeSpec, end: TimeSpec): Draft | undefined {
  const { title, location } = source;
  if (start.kind === 'date') {
    // 结束没写对（早于开始或不是日期）时按一天算
    const endDate = end.kind === 'date' && end.key > start.key ? end.key : addDays(start.key, 1);
    if (!(start.key < ctx.to && endDate > ctx.from)) return undefined;
    const id = idOf(source, start, ctx.timeZone);
    const event: CalendarEvent = { kind: 'all-day', id, title, location, startDate: start.key, endDate };
    return { event, sortMs: startOfDayMs(start.key, ctx.timeZone) };
  }
  const startMs = exactMs(start, ctx.timeZone);
  const endMs = end.kind === 'date' ? startMs : Math.max(startMs, exactMs(end, ctx.timeZone));
  // 零时长的日程落在窗口起点也算
  const overlaps = startMs < ctx.toMs && (endMs > ctx.fromMs || (endMs === startMs && startMs >= ctx.fromMs));
  if (!overlaps) return undefined;
  const id = idOf(source, start, ctx.timeZone);
  return { event: { kind: 'timed', id, title, location, start: startMs, end: endMs }, sortMs: startMs };
}

function expandSingles(ctx: Context, singles: readonly EventRecord[], tally: Tally): Draft[] {
  const drafts: Draft[] = [];
  for (const record of singles) {
    const startRough = approxMs(record.start);
    const endRough = Math.max(startRough, approxMs(record.end));
    if (startRough - SLACK_MS >= ctx.toRough || endRough + SLACK_MS < ctx.fromRough) continue;
    try {
      const draft = draftOf(ctx, record, record.start, record.end);
      if (draft) drafts.push(draft);
    } catch {
      tally.invalid += 1;
    }
  }
  return drafts;
}

/** 重复日程的某一次；被单独改过、被取消的返回 undefined */
function occurrenceDraft(ctx: Context, series: SeriesRecord, next: ICAL.Time, skip: ReadonlySet<string>, zone: string | undefined): Draft | undefined {
  const rid = specOf(next, zone);
  if (!rid || skip.has(keyOf(rid, ctx.timeZone))) return undefined;
  const details = series.event.getOccurrenceDetails(next);
  const item = series.items.get(details.item);
  if (!item || item.cancelled) return undefined;
  const start = specOf(details.startDate, item.zone);
  if (!start) return undefined;
  const end = (details.endDate && specOf(details.endDate, item.zone)) || start;
  return draftOf(ctx, { uid: series.uid, rid, title: item.title, location: item.location }, start, end);
}

/** 从 DTSTART 起逐次迭代；ical.js 按时间顺序给出，越过窗口就停 */
function expandSeries(ctx: Context, series: SeriesRecord, tally: Tally): Draft[] {
  const { limits } = ctx;
  const zone = series.items.get(series.event)?.zone;
  const skip = new Set(series.overridden.map((spec) => keyOf(spec, ctx.timeZone)));
  const drafts: Draft[] = [];
  const iterator = series.event.iterator();
  let steps = 0;
  for (let next = iterator.next(); next; next = iterator.next()) {
    steps += 1;
    tally.steps += 1;
    if (steps > limits.maxStepsPerSeries || tally.steps > limits.maxSteps) {
      tally.truncated = true;
      break;
    }
    const rough = roughMs(next);
    if (rough - series.reachMs - SLACK_MS >= ctx.toRough) break;
    if (rough + series.reachMs + SLACK_MS < ctx.fromRough) continue;
    const draft = occurrenceDraft(ctx, series, next, skip, zone);
    if (!draft) continue;
    drafts.push(draft);
    if (drafts.length >= limits.maxEventsPerSeries) {
      tally.truncated = true;
      break;
    }
  }
  return drafts;
}

/** 每个系列单独限时。只有用满了自己的全部预算才超时、或确实出错，才记为坏系列 */
function expandGuarded(ctx: Context, series: SeriesRecord, tally: Tally, budgetMs: number): readonly Draft[] {
  try {
    return runWithBudget(budgetMs, () => expandSeries(ctx, series, tally));
  } catch (error) {
    const timedOut = error instanceof TimeBudgetExceeded;
    if (timedOut) tally.timeout += 1;
    else tally.invalid += 1;
    if (!timedOut || budgetMs >= ctx.limits.seriesBudgetMs) poisoned.add(series);
    return [];
  }
}

function compareDrafts(a: Draft, b: Draft): number {
  if (a.sortMs !== b.sortMs) return a.sortMs - b.sortMs;
  // 同一时刻全天在前
  const allDay = Number(b.event.kind === 'all-day') - Number(a.event.kind === 'all-day');
  if (allDay !== 0) return allDay;
  if (a.event.title !== b.event.title) return a.event.title < b.event.title ? -1 : 1;
  return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0;
}

/** 排序、截断、给重复的 id 加 #2 #3（同一 UID 重复出现的文件里会有） */
function finish(drafts: readonly Draft[], maxEvents: number): { readonly events: readonly CalendarEvent[]; readonly cut: boolean } {
  const sorted = [...drafts].sort(compareDrafts);
  const kept = sorted.slice(0, maxEvents);
  const seen = new Map<string, number>();
  const events = kept.map(({ event }) => {
    const count = (seen.get(event.id) ?? 0) + 1;
    seen.set(event.id, count);
    return Object.freeze(count === 1 ? event : { ...event, id: `${event.id}#${count}` });
  });
  return { events: Object.freeze(events), cut: sorted.length > kept.length };
}

function contextOf(window: ExpandWindow, limits: ExpandLimits): Context {
  const { from, to, timeZone } = window;
  const rough = (key: string) => approxMs({ kind: 'date', key });
  return {
    from,
    to,
    timeZone,
    fromMs: startOfDayMs(from, timeZone),
    toMs: startOfDayMs(to, timeZone),
    fromRough: rough(from),
    toRough: rough(to),
    limits,
  };
}

/** 展开窗口内的全部日程。调用方负责保证日期键、时区合法，且 from < to */
export function expandFeed(feed: ParsedFeed, window: ExpandWindow, limits: ExpandLimits = DEFAULT_LIMITS): Expansion {
  const ctx = contextOf(window, limits);
  const tally: Tally = { steps: 0, timeout: 0, invalid: 0, truncated: false };
  const deadline = performance.now() + limits.totalBudgetMs;
  const drafts = expandSingles(ctx, feed.singles, tally);
  for (const series of feed.series) {
    if (poisoned.has(series)) {
      tally.invalid += 1;
      continue;
    }
    const remaining = deadline - performance.now();
    if (remaining < 1) {
      tally.truncated = true;
      break;
    }
    drafts.push(...expandGuarded(ctx, series, tally, Math.min(limits.seriesBudgetMs, remaining)));
  }
  const { events, cut } = finish(drafts, limits.maxEvents);
  const issues = { timeout: tally.timeout, invalid: tally.invalid, truncated: tally.truncated || cut };
  return Object.freeze({ events, issues: Object.freeze(issues) });
}
