import { eventSpan } from '../../adapters/calendar/days';
import type { CalendarEvent } from '../../adapters/calendar/model';
import { diffDays, weekdayOf } from '../../lib/zoned-time';

/** Deadline：日历订阅里今天及以后的事项，按剩余天数排，最近的在前 */

export interface DeadlineRow {
  readonly id: string;
  readonly title: string;
  /** 还剩几天；今天截止为 0 */
  readonly daysLeft: number;
  /** 'YYYY-MM-DD' */
  readonly date: string;
  /** 例如“09.30 周三”；不在今年的带上年份：“2027.01.04 周一” */
  readonly dateText: string;
  /** 最近几天的红笔批注；有批注的一行数字也标红 */
  readonly note: string | undefined;
}

// 下标是剩余天数
const NOTES = ['今天截止', '明天就截止', '后天截止'];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dateText(date: string, today: string): string {
  const [year, month, day] = date.split('-');
  const short = `${month}.${day} ${WEEKDAYS[weekdayOf(date)]}`;
  return year === today.slice(0, 4) ? short : `${year}.${short}`;
}

/**
 * today 是站点时区的今天。按天算：今天截止的事项今天一整天都列着（定时的过了钟点也一样），
 * 开始日期早于今天的（包括还没结束的跨天事项）不再列出
 */
export function deadlineRows(
  events: readonly CalendarEvent[],
  today: string,
  timeZone: string,
  max: number,
): readonly DeadlineRow[] {
  return (
    events
      .map((event) => ({ event, date: eventSpan(event, timeZone).first }))
      .filter(({ date }) => date >= today)
      // 同一天的保持订阅里的先后（sort 是稳定的）
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(0, max)
      .map(({ event, date }) => {
        const daysLeft = diffDays(today, date);
        return { id: event.id, title: event.title, daysLeft, date, dateText: dateText(date, today), note: NOTES[daysLeft] };
      })
  );
}
