import { describe, expect, it } from 'vitest';
import type { AllDayEvent, TimedEvent } from '../../../src/adapters/calendar/model';
import { addDays } from '../../../src/lib/zoned-time';
import { deadlineRows } from '../../../src/widgets/deadline/present';

const TZ = 'Asia/Shanghai';
const TODAY = '2026-09-30';

/** 单日的全天事项 */
function due(id: string, startDate: string): AllDayEvent {
  return { kind: 'all-day', id, title: `事项 ${id}`, location: undefined, startDate, endDate: addDays(startDate, 1) };
}

describe('deadlineRows', () => {
  it('counts the days left and lists the nearest first', () => {
    const events = [due('passport', '2026-10-17'), due('ticket', '2026-09-30'), due('report', '2026-10-02')];

    const rows = deadlineRows(events, TODAY, TZ, 5);

    expect(rows.map(({ id, daysLeft, dateText }) => [id, daysLeft, dateText])).toEqual([
      ['ticket', 0, '09.30 周三'],
      ['report', 2, '10.02 周五'],
      ['passport', 17, '10.17 周六'],
    ]);
    expect(rows[0]).toMatchObject({ title: '事项 ticket', date: '2026-09-30' });
  });

  it('leaves out anything that has already started, including multi-day events still running', () => {
    const events = [due('last-week', '2026-09-20'), { ...due('trip', '2026-09-28'), endDate: '2026-10-03' }];

    expect(deadlineRows(events, TODAY, TZ, 5)).toEqual([]);
  });

  it('adds a red note for today, tomorrow and the day after only', () => {
    const events = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map((date) => due(date, date));

    expect(deadlineRows(events, TODAY, TZ, 5).map(({ note }) => note)).toEqual(['今天截止', '明天就截止', '后天截止', undefined]);
  });

  it('shows the year for dates outside the current year', () => {
    const [row] = deadlineRows([due('renewal', '2027-01-04')], TODAY, TZ, 5);

    expect(row).toMatchObject({ daysLeft: 96, dateText: '2027.01.04 周一' });
  });

  it('dates a timed deadline by its start in the site time zone', () => {
    // 东八区 10 月 1 日 00:30，按 UTC 还是 9 月 30 日
    const exam: TimedEvent = {
      kind: 'timed',
      id: 'exam',
      title: '报名截止',
      location: '网上',
      start: Date.parse('2026-10-01T00:30+08:00'),
      end: Date.parse('2026-10-01T01:00+08:00'),
    };

    expect(deadlineRows([exam], TODAY, TZ, 5)[0]).toMatchObject({ date: '2026-10-01', daysLeft: 1 });
  });

  it('keeps a timed deadline listed for its whole day, even after the time has passed', () => {
    // 今天早上 09:00 截止：按天算，今天一整天都还列着
    const call: TimedEvent = {
      kind: 'timed',
      id: 'call',
      title: '提交材料',
      location: undefined,
      start: Date.parse('2026-09-30T09:00+08:00'),
      end: Date.parse('2026-09-30T09:30+08:00'),
    };

    expect(deadlineRows([call], TODAY, TZ, 5)).toMatchObject([{ id: 'call', daysLeft: 0, note: '今天截止' }]);
  });

  it('keeps at most max rows, and the feed order within a day', () => {
    const events = [due('b', '2026-10-05'), due('a1', '2026-10-01'), due('a2', '2026-10-01'), due('c', '2026-10-09')];

    expect(deadlineRows(events, TODAY, TZ, 3).map(({ id }) => id)).toEqual(['a1', 'a2', 'b']);
  });
});
