import { afterEach, describe, expect, it } from 'vitest';
import {
  addDays,
  canonicalTimeZone,
  diffDays,
  formatDateKey,
  isDateKey,
  localDateKey,
  localTimeText,
  parseDateKey,
  startOfDayMs,
  weekdayOf,
  zonedWallTimeToMs,
} from '../../src/lib/zoned-time';

const iso = (ms: number) => new Date(ms).toISOString();
const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe('localDateKey / localTimeText', () => {
  it('reads the day and the wall clock in the given zone, not the server zone', () => {
    // Arrange：服务器在洛杉矶，站点在上海
    process.env.TZ = 'America/Los_Angeles';
    const ms = Date.parse('2026-09-06T16:30:00Z');

    // Act / Assert
    expect(localDateKey(ms, 'Asia/Shanghai')).toBe('2026-09-07');
    expect(localTimeText(ms, 'Asia/Shanghai')).toBe('00:30');
    expect(localDateKey(ms, 'UTC')).toBe('2026-09-06');
    expect(localTimeText(Date.parse('2026-09-07T11:05:59Z'), 'Asia/Shanghai')).toBe('19:05');
  });
});

describe('zonedWallTimeToMs', () => {
  it('converts ordinary wall times with the zone offset', () => {
    expect(iso(zonedWallTimeToMs(2026, 9, 7, 9, 30, 0, 'Asia/Shanghai'))).toBe('2026-09-07T01:30:00.000Z');
    expect(iso(zonedWallTimeToMs(2026, 1, 15, 9, 0, 0, 'Europe/Madrid'))).toBe('2026-01-15T08:00:00.000Z');
    expect(iso(zonedWallTimeToMs(2026, 7, 15, 9, 0, 0, 'Europe/Madrid'))).toBe('2026-07-15T07:00:00.000Z');
  });

  it('moves wall times inside the spring-forward gap past the jump (Europe/Madrid)', () => {
    // 2026-03-29 02:00 CET 直接跳到 03:00 CEST，02:30 不存在
    expect(iso(zonedWallTimeToMs(2026, 3, 29, 2, 30, 0, 'Europe/Madrid'))).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(zonedWallTimeToMs(2026, 3, 29, 3, 0, 0, 'Europe/Madrid'))).toBe('2026-03-29T01:00:00.000Z');
    expect(localTimeText(zonedWallTimeToMs(2026, 3, 29, 2, 30, 0, 'Europe/Madrid'), 'Europe/Madrid')).toBe('03:30');
  });

  it('takes the earlier instant for repeated wall times in the fall-back overlap (Europe/Madrid)', () => {
    // 2026-10-25 03:00 CEST 回拨到 02:00 CET，02:30 出现两次
    expect(iso(zonedWallTimeToMs(2026, 10, 25, 2, 30, 0, 'Europe/Madrid'))).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(zonedWallTimeToMs(2026, 10, 25, 3, 0, 0, 'Europe/Madrid'))).toBe('2026-10-25T02:00:00.000Z');
  });

  it('gives the same answer whatever the server zone is', () => {
    const zones = ['UTC', 'Asia/Shanghai', 'America/New_York', 'Europe/Madrid'];
    const results = zones.map((zone) => {
      process.env.TZ = zone;
      return zonedWallTimeToMs(2026, 10, 25, 2, 30, 0, 'Europe/Madrid');
    });
    expect(new Set(results).size).toBe(1);
  });

  it('carries overflowing fields like Date does and keeps two-digit years literal', () => {
    expect(iso(zonedWallTimeToMs(2026, 9, 30, 24, 0, 0, 'UTC'))).toBe('2026-10-01T00:00:00.000Z');
    expect(iso(zonedWallTimeToMs(2026, 12, 32, 0, 0, 0, 'UTC'))).toBe('2027-01-01T00:00:00.000Z');
    expect(new Date(zonedWallTimeToMs(33, 3, 1, 0, 0, 0, 'UTC')).getUTCFullYear()).toBe(33);
  });
});

describe('startOfDayMs', () => {
  it('returns local midnight, including on DST change days', () => {
    expect(iso(startOfDayMs('2026-09-07', 'Asia/Shanghai'))).toBe('2026-09-06T16:00:00.000Z');
    expect(iso(startOfDayMs('2026-03-29', 'Europe/Madrid'))).toBe('2026-03-28T23:00:00.000Z');
    expect(iso(startOfDayMs('2026-10-25', 'Europe/Madrid'))).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfDayMs('2026-03-30', 'Europe/Madrid') - startOfDayMs('2026-03-29', 'Europe/Madrid')).toBe(23 * 3600_000);
  });

  it('starts right after the jump when midnight itself is skipped (America/Santiago)', () => {
    // 智利在 9 月第一个周日 00:00 拨快到 01:00，那天没有 00:00
    const start = startOfDayMs('2026-09-06', 'America/Santiago');
    expect(localDateKey(start, 'America/Santiago')).toBe('2026-09-06');
    expect(localTimeText(start, 'America/Santiago')).toBe('01:00');
    expect(localDateKey(start - 1000, 'America/Santiago')).toBe('2026-09-05');
  });

  it('rejects invalid keys', () => {
    expect(() => startOfDayMs('2026-02-30', 'UTC')).toThrow(RangeError);
  });
});

describe('date key arithmetic', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-09-07', 0)).toBe('2026-09-07');
    expect(() => addDays('2026-09-07', 0.5)).toThrow(RangeError);
  });

  it('counts whole days even across DST changes', () => {
    process.env.TZ = 'Europe/Madrid';
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2026-10-01', '2026-09-01')).toBe(-30);
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
    expect(diffDays('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('knows the weekday, 0 being Sunday', () => {
    expect(weekdayOf('2026-09-06')).toBe(0);
    expect(weekdayOf('2026-09-07')).toBe(1);
    expect(weekdayOf('2026-10-01')).toBe(4);
  });
});

describe('parseDateKey / isDateKey', () => {
  it('parses valid keys and rejects malformed or impossible dates', () => {
    expect(parseDateKey('2026-09-07')).toEqual({ year: 2026, month: 9, day: 7 });
    for (const bad of ['2026-02-30', '2026-13-01', '2026-9-7', '0000-01-01', '2026-09-07T00:00', ' 2026-09-07']) {
      expect(parseDateKey(bad), bad).toBeUndefined();
      expect(isDateKey(bad), bad).toBe(false);
    }
    expect(isDateKey(20260907)).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
  });

  it('formats parts back into zero-padded keys', () => {
    expect(formatDateKey({ year: 33, month: 3, day: 1 })).toBe('0033-03-01');
  });
});

describe('canonicalTimeZone', () => {
  it('normalizes the spelling of known zones and rejects unknown ones', () => {
    expect(canonicalTimeZone('asia/shanghai')).toBe('Asia/Shanghai');
    expect(canonicalTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
    expect(canonicalTimeZone('Mars/Olympus')).toBeUndefined();
    expect(canonicalTimeZone('')).toBeUndefined();
  });
});
