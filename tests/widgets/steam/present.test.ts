import { describe, expect, it } from 'vitest';
import type { SteamGame } from '../../../src/adapters/steam/model';
import { coverFallbackUrl, coverUrl, gameDetail, gameRows, hoursText } from '../../../src/widgets/steam/present';

const TZ = 'Asia/Shanghai';
// 2026-09-30 12:00 +08:00
const NOW = Date.parse('2026-09-30T12:00:00+08:00');

function game(overrides: Partial<SteamGame> = {}): SteamGame {
  return {
    appId: 570,
    name: 'Dota 2',
    recentMinutes: 138,
    totalMinutes: 48_720,
    lastPlayedAt: undefined,
    ...overrides,
  };
}

describe('coverUrl', () => {
  it('builds the Akamai portrait library URL for an app id', () => {
    expect(coverUrl(570)).toBe('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/570/library_600x900.jpg');
  });

  it('falls back to the landscape header', () => {
    expect(coverFallbackUrl(570)).toBe('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/570/header.jpg');
  });
});

describe('hoursText', () => {
  it('shows one decimal under 100 hours', () => {
    expect(hoursText(48)).toBe('0.8 小时');
    expect(hoursText(138)).toBe('2.3 小时');
  });

  it('rounds to a whole number at 100 hours and above', () => {
    expect(hoursText(6_015)).toBe('100 小时');
    expect(hoursText(48_720)).toBe('812 小时');
  });

  it('rounds down to zero for a few minutes', () => {
    expect(hoursText(2)).toBe('0.0 小时');
  });
});

describe('gameRows / meta', () => {
  it('labels today, yesterday, a weekday within a week, and a date beyond that', () => {
    const today = Date.parse('2026-09-30T09:00:00+08:00');
    const yesterday = Date.parse('2026-09-29T09:00:00+08:00');
    const thisWeek = Date.parse('2026-09-25T09:00:00+08:00'); // 周五，5 天前
    const older = Date.parse('2026-09-10T09:00:00+08:00');
    const rows = gameRows(
      [
        game({ appId: 1, name: '今天', lastPlayedAt: today }),
        game({ appId: 2, name: '昨天', lastPlayedAt: yesterday }),
        game({ appId: 3, name: '本周', lastPlayedAt: thisWeek }),
        game({ appId: 4, name: '更早', lastPlayedAt: older }),
      ],
      { now: NOW, timeZone: TZ, count: 4 },
    );

    expect(rows.map((row) => row.meta)).toEqual([
      `今天 · ${hoursText(138)}`,
      `昨天 · ${hoursText(138)}`,
      `周五 · ${hoursText(138)}`,
      `09月10日 · ${hoursText(138)}`,
    ]);
  });

  it('falls back to the two-week total when there is no last-played date', () => {
    const [row] = gameRows([game({ lastPlayedAt: undefined })], { now: NOW, timeZone: TZ, count: 4 });

    expect(row!.meta).toBe(`近两周 ${hoursText(138)}`);
  });

  it('builds the cover url and name from the game', () => {
    const [row] = gameRows([game({ appId: 730, name: 'CS2' })], { now: NOW, timeZone: TZ, count: 4 });

    expect(row).toMatchObject({ appId: 730, name: 'CS2', cover: coverUrl(730), coverFallback: coverFallbackUrl(730) });
  });

  it('sorts the currently-playing game first, then by most recent play date, then feed order for undated games', () => {
    const rows = gameRows(
      [
        game({ appId: 1, name: 'older-dated', lastPlayedAt: Date.parse('2026-09-10T00:00:00+08:00') }),
        game({ appId: 2, name: 'undated-a', lastPlayedAt: undefined }),
        game({ appId: 3, name: 'newer-dated', lastPlayedAt: Date.parse('2026-09-28T00:00:00+08:00') }),
        game({ appId: 4, name: 'undated-b', lastPlayedAt: undefined }),
        game({ appId: 5, name: 'playing-now', lastPlayedAt: Date.parse('2026-09-01T00:00:00+08:00') }),
      ],
      { now: NOW, timeZone: TZ, count: 10, playingAppId: 5 },
    );

    expect(rows.map((row) => row.name)).toEqual(['playing-now', 'newer-dated', 'older-dated', 'undated-a', 'undated-b']);
  });

  it('slices to count after sorting', () => {
    const rows = gameRows(
      [game({ appId: 1, name: 'a' }), game({ appId: 2, name: 'b' }), game({ appId: 3, name: 'c' })],
      { now: NOW, timeZone: TZ, count: 2 },
    );

    expect(rows).toHaveLength(2);
  });
});

describe('gameDetail', () => {
  it('shows the total hours and last-played date', () => {
    const detail = gameDetail(game({ totalMinutes: 48_720, lastPlayedAt: Date.parse('2026-09-29T00:00:00+08:00') }), TZ);

    expect(detail).toBe('累计 812 小时 · 上次 09月29日');
  });

  it('omits the date when there is none', () => {
    expect(gameDetail(game({ totalMinutes: 48_720, lastPlayedAt: undefined }), TZ)).toBe('累计 812 小时');
  });
});
