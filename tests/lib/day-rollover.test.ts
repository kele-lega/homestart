import { describe, expect, it } from 'vitest';
import {
  claimDeviceReload,
  dayChanged,
  rolloverClock,
  ROLLOVER_KEY,
  STALE_MS,
  type RolloverStore,
} from '../../src/lib/day-rollover';

const TZ = 'Asia/Shanghai';
const TODAY = '2026-09-30';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// 上海 2026-10-01 00:00 = 2026-09-30T16:00Z；页面在上海 09-30 23:50 渲染
const MIDNIGHT = Date.UTC(2026, 8, 30, 16);
const RENDERED = MIDNIGHT - 10 * MINUTE;

describe('rolloverClock', () => {
  it('trusts the render time of a document fresh from the server, however far off the device clock is', () => {
    const cases = [
      [0, 0],
      [DAY, -DAY],
      [-3 * 60 * MINUTE, 3 * 60 * MINUTE],
      [5_000, -5_000],
    ] as const;
    for (const [skew, offset] of cases) {
      const clock = rolloverClock({ renderedAt: RENDERED, loadedAt: RENDERED + skew, fromCache: false });

      expect(clock, String(skew)).toEqual({ kind: 'server', offset });
    }
  });

  it('still trusts a copy from the local cache while it is recent', () => {
    const clock = rolloverClock({ renderedAt: RENDERED, loadedAt: RENDERED + STALE_MS, fromCache: true });

    expect(clock).toEqual({ kind: 'server', offset: -STALE_MS });
  });

  it('falls back to the device clock for an old copy, or a copy from a device whose clock is off', () => {
    for (const gap of [STALE_MS + 1, DAY, -(STALE_MS + 1)]) {
      const clock = rolloverClock({ renderedAt: RENDERED, loadedAt: RENDERED + gap, fromCache: true });

      expect(clock, String(gap)).toEqual({ kind: 'device' });
    }
  });
});

describe('dayChanged', () => {
  it('estimates the server time from the offset, so a device a day ahead does not count as tomorrow', () => {
    const clock = { kind: 'server', offset: -DAY } as const;

    expect(dayChanged(TODAY, TZ, clock, RENDERED + DAY)).toBe(false);
    expect(dayChanged(TODAY, TZ, clock, MIDNIGHT + DAY - 1)).toBe(false);
    expect(dayChanged(TODAY, TZ, clock, MIDNIGHT + DAY)).toBe(true);
  });

  it('reads the device clock as is when told to', () => {
    const clock = { kind: 'device' } as const;

    expect(dayChanged(TODAY, TZ, clock, MIDNIGHT - 1)).toBe(false);
    expect(dayChanged(TODAY, TZ, clock, MIDNIGHT)).toBe(true);
    // 设备时钟慢了一天：日期也对不上，同样算作换了一天
    expect(dayChanged(TODAY, TZ, clock, RENDERED - DAY)).toBe(true);
  });

  it('decides the day in the site time zone', () => {
    const clock = { kind: 'server', offset: 0 } as const;

    // 16:00Z 在上海已是 10-01，在纽约还是 09-30 中午
    expect(dayChanged(TODAY, TZ, clock, MIDNIGHT)).toBe(true);
    expect(dayChanged(TODAY, 'America/New_York', clock, MIDNIGHT)).toBe(false);
  });
});

function memoryStore(): RolloverStore & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

describe('claimDeviceReload', () => {
  it('allows one reload per rendered day', () => {
    const store = memoryStore();

    expect(claimDeviceReload(TODAY, () => store)).toBe(true);
    expect(claimDeviceReload(TODAY, () => store)).toBe(false);
    expect(store.items.get(ROLLOVER_KEY)).toBe(TODAY);
    expect(claimDeviceReload('2026-10-01', () => store)).toBe(true);
  });

  it('refuses when storage is unavailable, so a wrong device clock can never cause a loop', () => {
    const denied = (): RolloverStore => {
      throw new DOMException('denied', 'SecurityError');
    };
    const full: RolloverStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };

    expect(claimDeviceReload(TODAY, denied)).toBe(false);
    expect(claimDeviceReload(TODAY, () => full)).toBe(false);
  });
});
