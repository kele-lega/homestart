/**
 * 月历翻页用的年月。浏览器端也用，不能引用 tyme4ts 等服务端模块
 */

export interface MonthKey {
  readonly year: number;
  /** 1~12 */
  readonly month: number;
}

// 农历和法定节假日数据在这个范围内可靠；翻页到边界为止
export const MIN_YEAR = 1901;
export const MAX_YEAR = 2099;

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
// 按四立分季，看每月中旬：立春、立夏、立秋、立冬都在月初，所以 2~4 月春，5~7 夏，8~10 秋，11~1 冬
const SEASONS = ['冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬', '冬'];
/** 表头，周一在前 */
export const WEEKDAY_HEADS = ['一', '二', '三', '四', '五', '六', '日'] as const;

export function inRange({ year, month }: MonthKey): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12;
}

/** 'YYYY-MM' */
export function formatMonthKey({ year, month }: MonthKey): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** 格式不对或超出翻页范围时返回 undefined */
export function parseMonthKey(key: string): MonthKey | undefined {
  const match = MONTH_KEY.exec(key);
  if (!match) return undefined;
  const parsed = { year: Number(match[1]), month: Number(match[2]) };
  return inRange(parsed) ? parsed : undefined;
}

export function shiftMonth({ year, month }: MonthKey, delta: number): MonthKey {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 'YYYY-MM-DD' 所在的月份；不检查翻页范围 */
export function monthOfDate(date: string): MonthKey {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export function sameMonth(a: MonthKey, b: MonthKey): boolean {
  return a.year === b.year && a.month === b.month;
}

export interface MonthCaption {
  readonly year: string;
  /** '九月' */
  readonly name: string;
  /** 大号月份旁的小字 '九月 · 秋' */
  readonly detail: string;
}

export function monthCaption({ year, month }: MonthKey): MonthCaption {
  const name = MONTH_NAMES[month - 1]!;
  return { year: String(year), name, detail: `${name} · ${SEASONS[month - 1]}` };
}
