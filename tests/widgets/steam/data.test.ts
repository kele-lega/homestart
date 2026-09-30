import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SteamSnapshot } from '../../../src/adapters/steam/model';
import { getSteamSnapshot } from '../../../src/adapters/steam/service';
import { parseSite } from '../../../src/core/site';
import { loadSteamView, toSteamView } from '../../../src/widgets/steam/data';

vi.mock('../../../src/adapters/steam/service', () => ({ getSteamSnapshot: vi.fn() }));

const TZ = 'Asia/Shanghai';
const NOW = Date.parse('2026-09-30T12:00:00+08:00');

function snapshot(overrides: Partial<SteamSnapshot> = {}): SteamSnapshot {
  return { steamId: undefined, player: undefined, feed: { status: 'unbound' }, ...overrides };
}

describe('toSteamView', () => {
  it('shows the unbound feed with no account', () => {
    const view = toSteamView(snapshot(), 4, NOW, TZ);

    expect(view).toEqual({ account: undefined, sub: '最近游玩', feed: { status: 'unbound' } });
  });

  it('carries through nokey, hidden and error feeds unchanged, with the account when bound', () => {
    const bound = snapshot({ steamId: '76561197960265729', feed: { status: 'hidden' } });

    expect(toSteamView(bound, 4, NOW, TZ)).toEqual({
      account: { steamId: '76561197960265729', name: undefined },
      sub: '最近游玩',
      feed: { status: 'hidden' },
    });
  });

  it('uses the player name in the account and switches the sub when playing', () => {
    const view = toSteamView(
      snapshot({
        steamId: '76561197960265729',
        player: { name: 'Ash', playing: { appId: 570, name: 'Dota 2' } },
        feed: { status: 'ok', games: [], stale: false },
      }),
      4,
      NOW,
      TZ,
    );

    expect(view.account).toEqual({ steamId: '76561197960265729', name: 'Ash' });
    expect(view.sub).toBe('正在玩 Dota 2');
  });

  it('turns an ok feed into rows and keeps the stale flag', () => {
    const view = toSteamView(
      snapshot({
        steamId: '76561197960265729',
        feed: {
          status: 'ok',
          stale: true,
          games: [{ appId: 570, name: 'Dota 2', recentMinutes: 120, totalMinutes: 6000, lastPlayedAt: undefined }],
        },
      }),
      4,
      NOW,
      TZ,
    );

    expect(view.feed).toMatchObject({ status: 'ok', stale: true });
    expect(view.feed.status === 'ok' && view.feed.rows).toMatchObject([{ appId: 570, name: 'Dota 2' }]);
  });
});

describe('loadSteamView', () => {
  beforeEach(() => {
    vi.mocked(getSteamSnapshot).mockReset().mockResolvedValue(snapshot());
  });

  it('loads the snapshot for the signed-in user and converts it with the request context', async () => {
    const context = { user: 'alice', signal: new AbortController().signal, site: parseSite({}) };

    const view = await loadSteamView(4, context);

    expect(getSteamSnapshot).toHaveBeenCalledWith('alice', { signal: context.signal });
    expect(view).toEqual({ account: undefined, sub: '最近游玩', feed: { status: 'unbound' } });
  });
});
