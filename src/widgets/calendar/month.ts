import type { DateRange } from '../../adapters/calendar/days';
import { cnDayInfo } from '../../lib/cn-calendar';
import { addDays, diffDays, formatDateKey, parseDateKey, weekdayOf } from '../../lib/zoned-time';
import { formatMonthKey, shiftMonth, type MonthKey } from './month-key';

/**
 * 月历的格子：公历、农历、节日节气、法定节假日。只在服务端计算，tyme4ts 的数据不进浏览器；
 * 翻页时由操作接口连同那个月的日程一起返回
 */

export interface DayCell {
  /** 'YYYY-MM-DD' */
  readonly date: string;
  readonly day: number;
  /** 数字下面的小字：节日 > 节气 > 初一显示月名 > 农历日 */
  readonly label: string;
  /** 小字是节日、节气或月名，用强调色 */
  readonly accent: boolean;
  /** 休息日：周末（调休上班的除外）和法定假日 */
  readonly rest: boolean;
  /** 法定节假日的角标：放假“休”，调休上班“班” */
  readonly badge: '休' | '班' | undefined;
  /** 读屏用的完整说明，例如“10月1日 星期四，农历八月廿一，国庆，国庆节放假” */
  readonly description: string;
  /** 不属于这个月、补齐首尾星期的格子 */
  readonly outside: boolean;
  readonly today: boolean;
}

export interface MonthGrid {
  /** 'YYYY-MM' */
  readonly key: string;
  readonly year: number;
  readonly month: number;
  /** 从周一开始、补齐整周的格子，4~6 行 */
  readonly cells: readonly DayCell[];
  /** 格子覆盖的日期范围，按它取日程 */
  readonly range: DateRange;
}

const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function cellOf(date: string, month: number, today: string): DayCell {
  const parts = parseDateKey(date);
  if (!parts) throw new RangeError(`无效的日期：${date}`);
  const info = cnDayInfo(parts.year, parts.month, parts.day);
  const weekday = weekdayOf(date);
  const { holiday } = info;
  const holidayNote = holiday && `${holiday.name}${holiday.work ? '调休上班' : '放假'}`;
  // 清明这类既是节气又是节日的，只念一次
  const notes = [...new Set([info.festival, info.term, holidayNote].filter((note) => note !== undefined))];
  return {
    date,
    day: parts.day,
    label: info.label,
    accent: info.labelKind !== 'day',
    rest: holiday ? !holiday.work : weekday === 0 || weekday === 6,
    badge: holiday ? (holiday.work ? '班' : '休') : undefined,
    description: [`${parts.month}月${parts.day}日 ${WEEKDAY_NAMES[weekday]}`, `农历${info.lunarMonth}${info.lunarDay}`, ...notes].join('，'),
    // 格子最多六周，只比月份就能分出首尾补上的日子
    outside: parts.month !== month,
    today: date === today,
  };
}

/** 某个月的格子；today 是站点时区的今天 */
export function monthGrid(key: MonthKey, today: string): MonthGrid {
  const first = formatDateKey({ ...key, day: 1 });
  const next = formatDateKey({ ...shiftMonth(key, 1), day: 1 });
  // weekdayOf 以星期日为 0，换成周一在前的列号
  const lead = (weekdayOf(first) + 6) % 7;
  const from = addDays(first, -lead);
  const length = Math.ceil((lead + diffDays(first, next)) / 7) * 7;
  const dates = Array.from({ length }, (_, index) => addDays(from, index));
  return {
    key: formatMonthKey(key),
    year: key.year,
    month: key.month,
    cells: dates.map((date) => cellOf(date, key.month, today)),
    range: { from, to: addDays(from, length) },
  };
}
