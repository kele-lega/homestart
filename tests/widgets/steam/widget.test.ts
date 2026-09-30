import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindSteamAccount, unbindSteamAccount } from '../../../src/adapters/steam/service';
import { parseSite } from '../../../src/core/site';
import { loadSteamView, type SteamView } from '../../../src/widgets/steam/data';
import steam from '../../../src/widgets/steam/widget';

vi.mock('../../../src/adapters/steam/service', () => ({ bindSteamAccount: vi.fn(), unbindSteamAccount: vi.fn() }));
vi.mock('../../../src/widgets/steam/data', () => ({ loadSteamView: vi.fn() }));

const { recent, bind, unbind } = steam.actions!;
const ctx = <B>(body: B) => ({ user: 'alice', signal: new AbortController().signal, site: parseSite({}), body });
const VIEW = { account: undefined, sub: '最近游玩', feed: { status: 'unbound' } } as unknown as SteamView;

beforeEach(() => {
  vi.mocked(loadSteamView).mockReset().mockResolvedValue(VIEW);
  vi.mocked(bindSteamAccount).mockReset().mockResolvedValue({ steamId: '76561197960265729' });
  vi.mocked(unbindSteamAccount).mockReset().mockResolvedValue({ steamId: undefined });
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

  it('reads recent with GET, binds with PUT and unbinds with DELETE', () => {
    expect(recent!.method ?? 'GET').toBe('GET');
    expect(recent!.body).toBeUndefined();
    expect(bind!.method).toBe('PUT');
    expect(bind!.body!.safeParse({}).success).toBe(false);
    expect(unbind!.method).toBe('DELETE');
    expect(unbind!.body).toBeUndefined();
  });
});

describe('steam recent action', () => {
  it('loads the view with the configured count and request context', async () => {
    const context = ctx(undefined);
    await expect(recent!.run({ count: 4 }, {}, context)).resolves.toBe(VIEW);

    expect(loadSteamView).toHaveBeenCalledWith(4, context);
  });
});

describe('steam bind / unbind actions', () => {
  it('binds the account for the signed-in user and answers with the steamId only', async () => {
    const result = await bind!.run({ count: 4 }, {}, ctx({ account: '76561197960265729' }));

    expect(bindSteamAccount).toHaveBeenCalledWith('alice', '76561197960265729');
    expect(result).toEqual({ steamId: '76561197960265729' });
  });

  it("unbinds the signed-in user's account", async () => {
    await expect(unbind!.run({ count: 4 }, {}, ctx(undefined))).resolves.toEqual({ steamId: undefined });
    expect(unbindSteamAccount).toHaveBeenCalledWith('alice');
  });
});
