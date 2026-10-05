/**
 * 按 IANA 时区换算日期与时刻。只用 Intl，结果与服务器所在时区无关：
 * 日历按 site.timezone 划分“今天”，Docker 里的 TZ 设成什么都不影响。
 *
 * 日期键是 'YYYY-MM-DD'（公元 1~9999 年）。加减天数、求差、星期都在 UTC 上按日历算，
 * 不经过本地时区的 Date，也就不会被夏令时多出或少掉的一小时带偏。
 */

const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateParts {
  readonly year: number;
  /** 1~12 */
  readonly month: number;
  readonly day: number;
}

interface WallParts extends DateParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** 各字段按字面换成 UTC 毫秒，越界时按 Date 的规则进位；Date.UTC 会把 0~99 年当成 1900 年代，这里不会 */
function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function formatDateKey({ year, month, day }: DateParts): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** 解析日期键；格式不对或日期不存在（如 2026-02-30）时返回 undefined */
export function parseDateKey(key: string): DateParts | undefined {
  const match = DATE_KEY.exec(key);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // 不存在的日期会被 Date 进位到下个月，换回来与原值不同即无效
  const date = new Date(utcMs(year, month, day));
  const same = date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  return same && year >= 1 ? { year, month, day } : undefined;
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && parseDateKey(value) !== undefined;
}

function requireKey(key: string): DateParts {
  const parts = parseDateKey(key);
  if (!parts) throw new RangeError(`无效的日期：${key}`);
  return parts;
}

function keyFromUtc(ms: number): string {
  const date = new Date(ms);
  return formatDateKey({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

export function addDays(key: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`天数必须是整数：${days}`);
  const { year, month, day } = requireKey(key);
  return keyFromUtc(utcMs(year, month, day + days));
}

/** to 比 from 晚几天；to 更早时为负数 */
export function diffDays(from: string, to: string): number {
  const a = requireKey(from);
  const b = requireKey(to);
  return Math.round((utcMs(b.year, b.month, b.day) - utcMs(a.year, a.month, a.day)) / DAY_MS);
}

/** 0 = 星期日 … 6 = 星期六 */
export function weekdayOf(key: string): number {
  const { year, month, day } = requireKey(key);
  return new Date(utcMs(year, month, day)).getUTCDay();
}

/** 规范写法的时区名（大小写按 IANA）；Intl 不认识时返回 undefined */
export function canonicalTimeZone(name: string): string | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

// 格式化器创建较慢，按时区缓存；时区名可能来自外部日历文件，数量设上限
const MAX_FORMATTERS = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // h23：午夜是 00 而不是 24
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  if (formatters.size >= MAX_FORMATTERS) formatters.delete(formatters.keys().next().value!);
  formatters.set(timeZone, formatter);
  return formatter;
}

function wallPartsAt(ms: number, timeZone: string): WallParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

/** 该时刻在时区里的 UTC 偏移（毫秒，东八区为 +28 800 000），精确到秒 */
function offsetAt(ms: number, timeZone: string): number {
  const p = wallPartsAt(ms, timeZone);
  return utcMs(p.year, p.month, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** 该时刻在时区里是哪一天 */
export function localDateKey(ms: number, timeZone: string): string {
  return formatDateKey(wallPartsAt(ms, timeZone));
}

/** 该时刻在时区里的钟面时间 'HH:mm'（24 小时制） */
export function localTimeText(ms: number, timeZone: string): string {
  const { hour, minute } = wallPartsAt(ms, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/**
 * 时区里的墙上时间 → UTC 毫秒。规则固定，与服务器时区无关，与 Temporal 的 disambiguation: 'compatible' 一致：
 * - 夏令时回拨，同一墙上时间出现两次：取较早的那次（回拨前的偏移），
 *   例如马德里 10 月最后一个周日的 02:30 → 00:30Z（CEST）；
 * - 夏令时拨快，这个墙上时间不存在：按跳变前的偏移换算，结果顺延到跳变之后，
 *   例如马德里 3 月最后一个周日的 02:30 → 01:30Z，即 03:30（CEST）。
 * 各字段越界时按 Date 的规则进位（24:00 → 次日 00:00）。假定前后一天内最多一次跳变，现行时区都满足。
 */
export function zonedWallTimeToMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const wall = utcMs(year, month, day, hour, minute, second);
  // 真正的时刻与 wall 相差不到 ±14 小时，前后各一天的偏移就是跳变前后的两个偏移
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const valid = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((ms) => offsetAt(ms, timeZone) === wall - ms);
  return valid.length > 0 ? Math.min(...valid) : wall - before;
}

/** 这一天在时区里的第一个时刻；当天 00:00 被夏令时跳过时是跳变之后的第一刻 */
export function startOfDayMs(key: string, timeZone: string): number {
  const { year, month, day } = requireKey(key);
  return zonedWallTimeToMs(year, month, day, 0, 0, 0, timeZone);
}
