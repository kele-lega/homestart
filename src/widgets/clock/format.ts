/** 时钟的纯格式化逻辑：服务端首屏渲染和浏览器端每分钟刷新共用 */

export interface ClockParts {
  readonly hours: string;
  readonly minutes: string;
  readonly seconds: string;
  /** 例如 2026.09.29 */
  readonly date: string;
  /** 例如 周二 */
  readonly weekday: string;
  /** 时区里的年月日，查农历用；month 为 1~12 */
  readonly year: number;
  readonly month: number;
  readonly day: number;
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
  return {
    hours: parts.hour ?? '00',
    minutes: parts.minute ?? '00',
    seconds: parts.second ?? '00',
    date: `${parts.year}.${parts.month}.${parts.day}`,
    weekday: parts.weekday ?? '',
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}
