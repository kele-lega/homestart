import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSite } from '../../../src/core/site';
import { loadSteamView, type SteamView } from '../../../src/widgets/steam/data';
import steam from '../../../src/widgets/steam/widget';

vi.mock('../../../src/widgets/steam/data', () => ({ loadSteamView: vi.fn() }));

const { recent } = steam.actions!;
const ctx = <B>(body: B) => ({ user: 'alice', signal: new AbortController().signal, site: parseSite({}), body });
const VIEW = { account: undefined, sub: '最近游玩', feed: { status: 'unbound' } } as unknown as SteamView;

beforeEach(() => {
  vi.mocked(loadSteamView).mockReset().mockResolvedValue(VIEW);
});

describe('steam widget', () => {
  it('draws its own head and defaults count to 4, capped between 1 and 10', () => {
    expect(steam.head).toBe('view');
    expect(steam.title).toBe('Steam');
    expect(steam.options.parse({})).toEqual({ count: 4 });
    expect(steam.options.safeParse({ count: 0 }).success).toBe(false);
    expect(steam.options.safeParse({ count: 11 }).success).toBe(false);
    expect(steam.options.safeParse({ other: 1 }).success).toBe(false);
  });

  it('only reads recent with GET; binding moved to /api/settings/steam', () => {
    expect(Object.keys(steam.actions!)).toEqual(['recent']);
    expect(recent!.method ?? 'GET').toBe('GET');
    expect(recent!.body).toBeUndefined();
  });

  it('lets the user override count within the same bounds as the options', () => {
    const { schema, apply } = steam.preferences!;
    expect(schema.safeParse({ count: 6 }).success).toBe(true);
    expect(schema.safeParse({ count: 0 }).success).toBe(false);
    expect(schema.safeParse({ count: 11 }).success).toBe(false);
    expect(schema.safeParse({ count: 2.5 }).success).toBe(false);
    expect(apply({ count: 4 }, { count: 6 })).toEqual({ count: 6 });
  });
});

describe('steam recent action', () => {
  it('loads the view with the configured count and request context', async () => {
    const context = ctx(undefined);
    await expect(recent!.run({ count: 4 }, {}, context)).resolves.toBe(VIEW);

    expect(loadSteamView).toHaveBeenCalledWith(4, context);
  });
});
