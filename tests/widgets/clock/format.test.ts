import { describe, expect, it } from 'vitest';
import { GREETINGS, formatClock, periodOf } from '../../../src/widgets/clock/format';

// 2026-09-29T06:05:09Z = 上海 14:05:09（周二），纽约 02:05:09（夏令时，同一天）
const INSTANT = new Date('2026-09-29T06:05:09Z');

describe('formatClock', () => {
  it('formats time and date in the configured time zone', () => {
    expect(formatClock(INSTANT, 'Asia/Shanghai', 'zh-CN')).toEqual({
      hours: '14',
      minutes: '05',
      seconds: '09',
      date: '2026.09.29',
      weekday: '周二',
      period: 'afternoon',
      year: 2026,
      month: 9,
      day: 29,
    });
  });

  it('uses the other zone’s calendar day and a zero-padded 24-hour clock', () => {
    const late = new Date('2026-09-29T16:30:00Z');
    expect(formatClock(late, 'Asia/Shanghai', 'zh-CN')).toMatchObject({
      hours: '00',
      minutes: '30',
      date: '2026.09.30',
      weekday: '周三',
      day: 30,
    });
    expect(formatClock(INSTANT, 'America/New_York', 'zh-CN')).toMatchObject({ hours: '02', date: '2026.09.29' });
  });
});

describe('periodOf', () => {
  it('maps every hour to a period with a greeting', () => {
    expect([0, 4, 5, 7, 8, 11, 12, 13, 14, 17, 18, 21, 22, 23].map(periodOf)).toEqual([
      'night', 'night', 'dawn', 'dawn', 'morning', 'morning', 'noon', 'noon',
      'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night',
    ]);
    for (let hour = 0; hour < 24; hour++) expect(GREETINGS[periodOf(hour)]).toBeTruthy();
  });
});
