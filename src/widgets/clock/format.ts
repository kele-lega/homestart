/** 时钟的纯格式化逻辑：服务端首屏渲染和浏览器端每分钟刷新共用 */

export type Period = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

export interface ClockParts {
  readonly hours: string;
  readonly minutes: string;
  readonly seconds: string;
  /** 例如 2026.09.29 */
  readonly date: string;
  /** 例如 周二 */
  readonly weekday: string;
  readonly period: Period;
  /** 时区里的年月日，查农历用；month 为 1~12 */
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export const GREETINGS: Readonly<Record<Period, string>> = {
  dawn: '早上好',
  morning: '上午好',
  noon: '中午好',
  afternoon: '下午好',
  evening: '晚上好',
  night: '夜深了',
};

// 每个时段的起始小时，按顺序匹配第一个满足条件的
const PERIOD_STARTS: readonly (readonly [number, Period])[] = [
  [22, 'night'],
  [18, 'evening'],
  [14, 'afternoon'],
  [12, 'noon'],
  [8, 'morning'],
  [5, 'dawn'],
];

export function periodOf(hour: number): Period {
  return PERIOD_STARTS.find(([start]) => hour >= start)?.[1] ?? 'night';
}

// Intl.DateTimeFormat 构造开销不小，按 时区 + 语言 缓存
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string, locale: string): Intl.DateTimeFormat {
  const key = `${timeZone}|${locale}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  formatters.set(key, created);
  return created;
}

export function formatClock(now: Date, timeZone: string, locale: string): ClockParts {
  const parts = Object.fromEntries(
    formatterFor(timeZone, locale)
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const hours = parts.hour ?? '00';
  return {
    hours,
    minutes: parts.minute ?? '00',
    seconds: parts.second ?? '00',
    date: `${parts.year}.${parts.month}.${parts.day}`,
    weekday: parts.weekday ?? '',
    period: periodOf(Number(hours)),
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}
