import { describe, expect, it } from 'vitest';
import { cacheable, moveInGrid, pageDelta, readMonth, readSettings } from '../../../src/widgets/calendar/client';
import type { MonthData } from '../../../src/widgets/calendar/data';

const MONTH = {
  grid: { key: '2026-09', year: 2026, month: 9, cells: [], range: { from: '2026-08-31', to: '2026-10-05' } },
  feed: { status: 'unconfigured' },
  settings: { configured: false },
};

describe('readMonth', () => {
  it('returns the month data of a successful response', () => {
    expect(readMonth({ success: true, data: MONTH })).toBe(MONTH);
  });

  it('returns nothing for failures and for bodies of the wrong shape', () => {
    const bodies = [
      undefined,
      null,
      'oops',
      [],
      { success: false, error: '请求太频繁，请稍后再试' },
      { success: true },
      { success: true, data: null },
      { success: 'true', data: MONTH },
      { success: true, data: { ...MONTH, grid: {} } },
      { success: true, data: { ...MONTH, feed: {} } },
      { success: true, data: { ...MONTH, settings: { configured: 'yes' } } },
    ];
    for (const body of bodies) expect(readMonth(body), JSON.stringify(body)).toBeUndefined();
  });
});

describe('readSettings', () => {
  it('returns the new settings of a successful response', () => {
    const settings = { configured: true, host: 'calendar.example.com' };
    expect(readSettings({ success: true, data: settings })).toEqual({ ok: true, settings });
    expect(readSettings({ success: true, data: { configured: false } })).toEqual({ ok: true, settings: { configured: false } });
  });

  it("passes the server's explanation through", () => {
    expect(readSettings({ success: false, error: '只支持 http 和 https 地址' })).toEqual({
      ok: false,
      message: '只支持 http 和 https 地址',
    });
  });

  it('falls back to a generic message when the response explains nothing', () => {
    for (const body of [undefined, 'oops', { success: false }, { success: false, error: '' }, { success: true, data: {} }]) {
      expect(readSettings(body), JSON.stringify(body)).toEqual({ ok: false, message: '保存失败，请稍后再试' });
    }
  });
});

// 5 周 35 格；下标 9 是第二周的周三
describe('moveInGrid', () => {
  it('moves a day with the side arrows and a week with the up and down arrows', () => {
    expect(moveInGrid('ArrowLeft', 9, 35)).toBe(8);
    expect(moveInGrid('ArrowRight', 9, 35)).toBe(10);
    expect(moveInGrid('ArrowUp', 9, 35)).toBe(2);
    expect(moveInGrid('ArrowDown', 9, 35)).toBe(16);
  });

  it('carries the side arrows over to the neighbouring week', () => {
    expect(moveInGrid('ArrowRight', 6, 35)).toBe(7);
    expect(moveInGrid('ArrowLeft', 7, 35)).toBe(6);
  });

  it('jumps to the start and end of the week with Home and End', () => {
    expect(moveInGrid('Home', 9, 35)).toBe(7);
    expect(moveInGrid('End', 9, 35)).toBe(13);
  });

  it('stays put at the edges of the grid and ignores other keys', () => {
    expect(moveInGrid('ArrowLeft', 0, 35)).toBeUndefined();
    expect(moveInGrid('ArrowUp', 3, 35)).toBeUndefined();
    expect(moveInGrid('ArrowRight', 34, 35)).toBeUndefined();
    expect(moveInGrid('ArrowDown', 30, 35)).toBeUndefined();
    for (const key of ['Enter', ' ', 'Tab', 'a', 'toString', 'constructor']) {
      expect(moveInGrid(key, 9, 35), key).toBeUndefined();
    }
  });
});

describe('pageDelta', () => {
  it('turns PageUp and PageDown into a month back and forward', () => {
    expect(pageDelta('PageUp')).toBe(-1);
    expect(pageDelta('PageDown')).toBe(1);
    expect(pageDelta('ArrowDown')).toBeUndefined();
  });
});

describe('cacheable', () => {
  const withFeed = (feed: MonthData['feed']): MonthData => ({ ...(MONTH as MonthData), feed });

  it('keeps months whose feed is fresh or not subscribed', () => {
    expect(cacheable(withFeed({ status: 'ok', stale: false, data: {} }))).toBe(true);
    expect(cacheable(withFeed({ status: 'unconfigured' }))).toBe(true);
  });

  it('does not keep a failed or stale feed, so the next visit asks the server again', () => {
    expect(cacheable(withFeed({ status: 'error', message: '连接超时' }))).toBe(false);
    expect(cacheable(withFeed({ status: 'ok', stale: true, data: {} }))).toBe(false);
  });
});
