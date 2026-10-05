import { describe, expect, it } from 'vitest';
import {
  formatMonthKey,
  inRange,
  monthCaption,
  monthOfDate,
  parseMonthKey,
  sameMonth,
  shiftMonth,
} from '../../../src/widgets/calendar/month-key';

describe('month keys', () => {
  it('formats and parses YYYY-MM', () => {
    expect(formatMonthKey({ year: 2026, month: 9 })).toBe('2026-09');
    expect(parseMonthKey('2026-09')).toEqual({ year: 2026, month: 9 });
  });

  it('rejects malformed keys and months outside the supported years', () => {
    for (const key of ['2026-9', '2026-13', '2026-00', '26-09', '2026-09-01', '1900-12', '2100-01', '']) {
      expect(parseMonthKey(key), key).toBeUndefined();
    }
    expect(parseMonthKey('1901-01')).toEqual({ year: 1901, month: 1 });
    expect(parseMonthKey('2099-12')).toEqual({ year: 2099, month: 12 });
  });

  it('checks the range of a month key built in code', () => {
    expect(inRange({ year: 2026, month: 9 })).toBe(true);
    expect(inRange({ year: 2026, month: 9.5 })).toBe(false);
    expect(inRange({ year: 2100, month: 1 })).toBe(false);
  });

  it('shifts across year boundaries in both directions', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 9 }, -21)).toEqual({ year: 2024, month: 12 });
  });

  it('captions the month with its Chinese name and season by the solar terms', () => {
    expect(monthCaption({ year: 2026, month: 9 })).toEqual({ year: '2026', name: '九月', detail: '九月 · 秋' });
    expect(monthCaption({ year: 2027, month: 2 })).toEqual({ year: '2027', name: '二月', detail: '二月 · 春' });
    expect(monthCaption({ year: 2026, month: 11 }).detail).toBe('十一月 · 冬');
    expect(monthCaption({ year: 2027, month: 1 }).detail).toBe('一月 · 冬');
  });

  it('finds the month of a date key and compares months', () => {
    expect(monthOfDate('2026-09-30')).toEqual({ year: 2026, month: 9 });
    expect(monthOfDate('2027-01-01')).toEqual({ year: 2027, month: 1 });
    expect(sameMonth({ year: 2026, month: 9 }, monthOfDate('2026-09-01'))).toBe(true);
    expect(sameMonth({ year: 2026, month: 9 }, { year: 2025, month: 9 })).toBe(false);
  });
});
