import { describe, expect, it } from 'vitest';
import { cnDayInfo, FESTIVAL_NAMES } from '../../src/lib/cn-calendar';

describe('cnDayInfo', () => {
  it('shows a solar term only on the day it begins', () => {
    // Act
    const bailu = cnDayInfo(2026, 9, 7);
    const next = cnDayInfo(2026, 9, 8);

    // Assert
    expect(bailu).toMatchObject({ term: '白露', label: '白露', labelKind: 'term', marked: true, lunarDay: '廿六' });
    expect(next).toMatchObject({ term: undefined, label: '廿七', labelKind: 'day', marked: false });
    expect(cnDayInfo(2026, 10, 8)).toMatchObject({ term: '寒露', label: '寒露', lunarMonth: '八月', lunarDay: '廿八' });
  });

  it('labels festivals with their short display name', () => {
    expect(cnDayInfo(2026, 9, 10)).toMatchObject({
      lunarMonth: '七月',
      lunarDay: '廿九',
      festival: '教师节',
      label: '教师节',
      labelKind: 'festival',
      marked: true,
    });
    expect(cnDayInfo(2026, 10, 1)).toMatchObject({
      festival: '国庆',
      label: '国庆',
      holiday: { name: '国庆节', work: false },
    });
    expect(cnDayInfo(2027, 1, 15)).toMatchObject({ festival: '腊八', label: '腊八' });
    expect(cnDayInfo(2026, 2, 16)).toMatchObject({ festival: '除夕', label: '除夕' });
  });

  it('marks Mid-Autumn as a day off', () => {
    expect(cnDayInfo(2026, 9, 25)).toMatchObject({
      lunarMonth: '八月',
      lunarDay: '十五',
      festival: '中秋',
      label: '中秋',
      holiday: { name: '中秋节', work: false },
    });
  });

  it('marks make-up working days (调休) with work = true', () => {
    expect(cnDayInfo(2026, 9, 20)).toMatchObject({
      lunarDay: '初十',
      festival: undefined,
      holiday: { name: '国庆节', work: true },
      label: '初十',
      marked: false,
    });
    expect(cnDayInfo(2026, 9, 9).holiday).toBeUndefined();
  });

  it('shows the month name on the first lunar day, with the leap prefix', () => {
    expect(cnDayInfo(2025, 7, 25)).toMatchObject({ lunarMonth: '闰六月', lunarDay: '初一', label: '闰六月', labelKind: 'month' });
    expect(cnDayInfo(2025, 6, 25)).toMatchObject({ lunarMonth: '六月', label: '六月' });
    expect(cnDayInfo(2026, 9, 11)).toMatchObject({ lunarMonth: '八月', label: '八月', labelKind: 'month', marked: false });
  });

  it('calls the 11th and 12th lunar months 冬月 and 腊月', () => {
    expect(cnDayInfo(2026, 12, 20).lunarMonth).toBe('冬月');
    expect(cnDayInfo(2027, 1, 20).lunarMonth).toBe('腊月');
  });

  it('puts the lunar New Year festival above the month name', () => {
    expect(cnDayInfo(2026, 2, 17)).toMatchObject({
      lunarMonth: '正月',
      lunarDay: '初一',
      festival: '春节',
      label: '春节',
      labelKind: 'festival',
      term: undefined,
    });
  });

  it('lets the festival win when a term and a festival share the day', () => {
    expect(cnDayInfo(2026, 4, 5)).toMatchObject({ term: '清明', festival: '清明', label: '清明', labelKind: 'festival' });
  });

  it('refuses years outside the supported range', () => {
    expect(() => cnDayInfo(10000, 1, 1)).toThrow();
  });
});

describe('FESTIVAL_NAMES', () => {
  it('keeps every display name within three characters', () => {
    for (const [raw, display] of Object.entries(FESTIVAL_NAMES)) {
      expect([...display].length, raw).toBeLessThanOrEqual(3);
      expect(display, raw).not.toBe(raw);
    }
  });
});
