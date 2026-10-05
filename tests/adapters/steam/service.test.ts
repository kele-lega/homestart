import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { RecentGame } from '../../../src/adapters/steam/api';
import type { SteamPlayer } from '../../../src/adapters/steam/model';
import { createSteamService, type SteamApi } from '../../../src/adapters/steam/service';
import { ANONYMOUS } from '../../../src/core/api';
import { UpstreamError } from '../../../src/core/http';
import { ActionInputError } from '../../../src/core/widget';

// 测试用的假 Key：格式与真 Key 相同（32 位十六进制），不是真的
const KEY = 'ab'.repeat(16);
const ID = '76561198000000001';
const OTHER_ID = '76561198000000002';
const MINUTE = 60_000;

const HADES: RecentGame = { appId: 1145350, name: 'Hades II', recentMinutes: 138, totalMinutes: 4000 };
const BALATRO: RecentGame = { appId: 2379780, name: 'Balatro', recentMinutes: 30, totalMinutes: 900 };
const LAST_PLAYED = 1_727_600_000_000;
const PLAYER: SteamPlayer = { name: 'Alice', playing: { appId: 1145350, name: 'Hades II' } };

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (user: string) => data.get(user)),
    put: vi.fn(async (user: string, value: string | undefined) => {
      if (value === undefined) data.delete(user);
      else data.set(user, value);
    }),
  };
}

function fakeApi() {
  return {
    fetchRecentGames: vi.fn<SteamApi['fetchRecentGames']>(async () => [HADES, BALATRO]),
    fetchLastPlayed: vi.fn<SteamApi['fetchLastPlayed']>(async () => new Map([[HADES.appId, LAST_PLAYED]])),
    fetchPlayer: vi.fn<SteamApi['fetchPlayer']>(async () => PLAYER),
    resolveVanity: vi.fn<SteamApi['resolveVanity']>(async () => ID),
  };
}

let time: number;
let api: ReturnType<typeof fakeApi>;
let store: ReturnType<typeof memoryStore>;
let log: MockInstance<typeof console.error>;

beforeEach(() => {
  time = 0;
  api = fakeApi();
  store = memoryStore({ alice: ID });
  log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const service = (apiKey: () => string | undefined = () => KEY) => createSteamService({ store, api, apiKey, now: () => time });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const logged = () => log.mock.calls.flat().map(String).join('\n');

describe('getSteamSnapshot：状态', () => {
  it('正常：最近游玩带上游戏库里的最后游玩时间，另附昵称和正在玩的游戏', async () => {
    // Act
    const snapshot = await service().getSteamSnapshot('alice');

    // Assert
    expect(snapshot).toEqual({
      steamId: ID,
      player: PLAYER,
      feed: {
        status: 'ok',
        stale: false,
        games: [
          { ...HADES, lastPlayedAt: LAST_PLAYED },
          { ...BALATRO, lastPlayedAt: undefined },
        ],
      },
    });
    expect(api.fetchRecentGames).toHaveBeenCalledWith(ID, { key: KEY });
  });

  it('服务器没配 Key：不请求 Steam，仍然告诉页面绑定的是谁', async () => {
    // Act
    const snapshot = await service(() => undefined).getSteamSnapshot('alice');

    // Assert
    expect(snapshot).toEqual({ steamId: ID, player: undefined, feed: { status: 'nokey' } });
    expect(api.fetchRecentGames).not.toHaveBeenCalled();
  });

  it('Key 格式不对按没配处理，只警告一次，警告里没有 Key', async () => {
    // Arrange
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const steam = service(() => ' not-a-key ');

    // Act
    const snapshots = [await steam.getSteamSnapshot('alice'), await steam.getSteamSnapshot('alice')];

    // Assert
    expect(snapshots.map((s) => s.feed)).toEqual([{ status: 'nokey' }, { status: 'nokey' }]);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('STEAM_API_KEY');
    expect(String(warn.mock.calls[0][0])).not.toContain('not-a-key');
  });

  it('默认每次都从环境变量 STEAM_API_KEY 读 Key', async () => {
    // Arrange
    const steam = createSteamService({ store, api, now: () => time });
    vi.stubEnv('STEAM_API_KEY', ` ${KEY.toUpperCase()} `);

    // Act
    const snapshot = await steam.getSteamSnapshot('alice');

    // Assert
    expect(snapshot.feed.status).toBe('ok');
    expect(api.fetchRecentGames).toHaveBeenCalledWith(ID, { key: KEY.toUpperCase() });
  });

  it.each([
    ['没绑定', 'bob'],
    ['未登录', ANONYMOUS],
  ])('%s：unbound', async (_name, user) => {
    // Act
    const snapshot = await service().getSteamSnapshot(user);

    // Assert
    expect(snapshot).toEqual({ steamId: undefined, player: undefined, feed: { status: 'unbound' } });
    expect(api.fetchRecentGames).not.toHaveBeenCalled();
  });

  it('游戏详情不公开：hidden，昵称照常显示', async () => {
    // Arrange
    api.fetchRecentGames.mockResolvedValueOnce(undefined);

    // Act
    const snapshot = await service().getSteamSnapshot('alice');

    // Assert
    expect(snapshot).toEqual({ steamId: ID, player: PLAYER, feed: { status: 'hidden' } });
  });

  it('游戏库读不到：只是没有最后游玩时间，记一条日志', async () => {
    // Arrange
    api.fetchLastPlayed.mockRejectedValueOnce(new UpstreamError('api.steampowered.com：请求超时'));

    // Act
    const { feed } = await service().getSteamSnapshot('alice');

    // Assert
    expect(feed).toMatchObject({ status: 'ok', games: [{ lastPlayedAt: undefined }, { lastPlayedAt: undefined }] });
    expect(logged()).toMatch(/\[steam\] alice .*请求超时/);
  });

  it('资料读不到：没有昵称和正在玩，游戏照常显示', async () => {
    // Arrange
    api.fetchPlayer.mockRejectedValueOnce(new UpstreamError('api.steampowered.com：fetch failed'));

    // Act
    const snapshot = await service().getSteamSnapshot('alice');

    // Assert
    expect(snapshot.player).toBeUndefined();
    expect(snapshot.feed.status).toBe('ok');
  });

  it.each([
    [undefined, '暂时连不上 Steam，稍后再试'],
    [403, 'Steam 拒绝了服务器配置的 API Key'],
    [401, 'Steam 拒绝了服务器配置的 API Key'],
    [429, 'Steam 请求太频繁，稍后再试'],
    [500, '暂时连不上 Steam，稍后再试'],
  ])('最近游玩读不到（HTTP %s）：%s；日志里有原因，没有 Key', async (status, message) => {
    // Arrange
    api.fetchRecentGames.mockRejectedValueOnce(new UpstreamError('api.steampowered.com 返回 HTTP xxx', status));

    // Act
    const { feed } = await service().getSteamSnapshot('alice');

    // Assert
    expect(feed).toEqual({ status: 'error', message });
    expect(logged()).toContain('api.steampowered.com 返回 HTTP xxx');
    expect(logged()).not.toContain(KEY);
  });

  it('不是上游问题的错误照常抛出', async () => {
    // Arrange
    api.fetchRecentGames.mockRejectedValueOnce(new TypeError('bug'));

    // Act + Assert
    await expect(service().getSteamSnapshot('alice')).rejects.toThrow('bug');
  });

  it('请求已取消时不读存储', async () => {
    // Act
    const result = service().getSteamSnapshot('alice', { signal: AbortSignal.abort() });

    // Assert
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.get).not.toHaveBeenCalled();
  });
});

describe('getSteamSnapshot：缓存', () => {
  it('游戏 15 分钟内、资料 2 分钟内直接用缓存', async () => {
    // Arrange
    const steam = service();

    // Act
    await steam.getSteamSnapshot('alice');
    time += 1 * MINUTE;
    await steam.getSteamSnapshot('alice');
    time += 2 * MINUTE;
    await steam.getSteamSnapshot('alice');

    // Assert
    expect(api.fetchRecentGames).toHaveBeenCalledOnce();
    expect(api.fetchLastPlayed).toHaveBeenCalledOnce();
    expect(api.fetchPlayer).toHaveBeenCalledTimes(2);
  });

  it('过期后先返回旧数据；后台刷新失败时标记 stale，刷新成功后恢复', async () => {
    // Arrange
    const steam = service();
    await steam.getSteamSnapshot('alice');
    time += 16 * MINUTE;
    api.fetchRecentGames.mockRejectedValueOnce(new UpstreamError('api.steampowered.com：请求超时'));

    // Act
    const first = await steam.getSteamSnapshot('alice');
    await flush();
    const second = await steam.getSteamSnapshot('alice');
    await flush();
    const third = await steam.getSteamSnapshot('alice');

    // Assert
    expect(first.feed).toMatchObject({ status: 'ok', stale: false });
    expect(second.feed).toMatchObject({ status: 'ok', stale: true });
    expect(third.feed).toMatchObject({ status: 'ok', stale: false });
    expect(api.fetchRecentGames).toHaveBeenCalledTimes(3);
  });

  it('换绑后不再用旧账号的缓存', async () => {
    // Arrange
    const steam = service();
    await steam.getSteamSnapshot('alice');

    // Act
    await steam.bindSteamAccount('alice', OTHER_ID);
    await steam.getSteamSnapshot('alice');

    // Assert
    expect(api.fetchRecentGames).toHaveBeenLastCalledWith(OTHER_ID, { key: KEY });
  });
});

describe('bindSteamAccount / unbindSteamAccount', () => {
  it.each([ID, `https://steamcommunity.com/profiles/${ID}/`])('直接填 SteamID64 或资料链接：%s', async (input) => {
    // Act
    const binding = await service().bindSteamAccount('bob', input);

    // Assert
    expect(binding).toEqual({ steamId: ID });
    expect(store.put).toHaveBeenCalledWith('bob', ID);
    expect(api.resolveVanity).not.toHaveBeenCalled();
  });

  it('自定义链接用 Key 查成 SteamID64 再保存', async () => {
    // Act
    const binding = await service().bindSteamAccount('bob', 'https://steamcommunity.com/id/alice_x/');

    // Assert
    expect(api.resolveVanity).toHaveBeenCalledWith('alice_x', { key: KEY });
    expect(binding).toEqual({ steamId: ID });
    expect(store.put).toHaveBeenCalledWith('bob', ID);
  });

  it.each([
    ['未登录', ANONYMOUS, ID, () => undefined, '未登录，无法保存 Steam 设置'],
    ['格式不对', 'bob', '12345', () => undefined, 'SteamID64 是 7656119 开头的 17 位数字'],
    ['没配 Key 时不能查自定义链接', 'bob', 'alice_x', () => undefined, '服务器没有配置 Steam API Key，请直接填 17 位 SteamID64'],
  ])('%s', async (_name, user, input, apiKey, message) => {
    // Act
    const result = service(apiKey).bindSteamAccount(user, input);

    // Assert
    await expect(result).rejects.toBeInstanceOf(ActionInputError);
    await expect(result).rejects.toThrow(message);
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each([
    ['查不到', async () => undefined, '找不到这个自定义链接，请检查拼写，或直接填 17 位 SteamID64'],
    ['连不上', async () => Promise.reject(new UpstreamError('api.steampowered.com：请求超时')), '暂时连不上 Steam，查不了自定义链接；可以直接填 17 位 SteamID64'],
  ])('自定义链接%s', async (_name, resolve, message) => {
    // Arrange
    api.resolveVanity.mockImplementationOnce(resolve);

    // Act
    const result = service().bindSteamAccount('bob', 'alice_x');

    // Assert
    await expect(result).rejects.toThrow(new ActionInputError(message));
    expect(store.put).not.toHaveBeenCalled();
  });

  it('解绑后是 unbound', async () => {
    // Arrange
    const steam = service();

    // Act
    const binding = await steam.unbindSteamAccount('alice');
    const snapshot = await steam.getSteamSnapshot('alice');

    // Assert
    expect(binding).toEqual({ steamId: undefined });
    expect(store.put).toHaveBeenCalledWith('alice', undefined);
    expect(snapshot.feed).toEqual({ status: 'unbound' });
  });

  it('未登录不能解绑', async () => {
    // Act + Assert
    await expect(service().unbindSteamAccount(ANONYMOUS)).rejects.toThrow('未登录，无法保存 Steam 设置');
  });
});
