import { describe, expect, it, vi } from 'vitest';
import { fetchLastPlayed, fetchPlayer, fetchRecentGames, resolveVanity } from '../../../src/adapters/steam/api';
import { UpstreamError } from '../../../src/core/http';

// 测试用的假 Key：格式与真 Key 相同（32 位十六进制），不是真的
const KEY = 'ab'.repeat(16);
const ID = '76561198000000001';

/** 依次返回给定的结果：Error 表示网络错误，Response 原样返回，其余按 JSON 返回 */
function fakeFetch(...results: unknown[]) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } });
  });
}

function requestOf(fetch: ReturnType<typeof fakeFetch>, call = 0) {
  const url = new URL(String(fetch.mock.calls[call][0]));
  return { endpoint: `${url.origin}${url.pathname}`, params: Object.fromEntries(url.searchParams) };
}

describe('fetchRecentGames', () => {
  it('请求最近游玩接口，换成与界面无关的数据；缺名字的用 appid 代替', async () => {
    // Arrange
    const fetch = fakeFetch({
      response: {
        total_count: 2,
        games: [
          { appid: 1145350, name: 'Hades II', playtime_2weeks: 138, playtime_forever: 4000, img_icon_url: 'x' },
          { appid: 413150, playtime_2weeks: 30, playtime_forever: 30 },
        ],
      },
    });

    // Act
    const games = await fetchRecentGames(ID, { key: KEY, fetch });

    // Assert
    expect(games).toEqual([
      { appId: 1145350, name: 'Hades II', recentMinutes: 138, totalMinutes: 4000 },
      { appId: 413150, name: 'App 413150', recentMinutes: 30, totalMinutes: 30 },
    ]);
    expect(requestOf(fetch)).toEqual({
      endpoint: 'https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/',
      params: { key: KEY, steamid: ID, format: 'json' },
    });
  });

  it.each([
    ['资料不公开时返回空的 response', { response: {} }, undefined],
    ['两周没玩', { response: { total_count: 0 } }, []],
  ])('%s', async (_name, body, expected) => {
    // Act + Assert
    await expect(fetchRecentGames(ID, { key: KEY, fetch: fakeFetch(body) })).resolves.toEqual(expected);
  });

  it('HTTP 错误不重试，带上状态码，消息里没有 Key', async () => {
    // Arrange
    const fetch = fakeFetch(new Response('Forbidden', { status: 403 }));

    // Act
    const error = await fetchRecentGames(ID, { key: KEY, fetch }).catch((e: unknown) => e);

    // Assert
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ status: 403, message: 'api.steampowered.com 返回 HTTP 403' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('网络错误重试一次', async () => {
    // Arrange
    const fetch = fakeFetch(new TypeError('fetch failed'), { response: { total_count: 0 } });

    // Act
    const games = await fetchRecentGames(ID, { key: KEY, fetch });

    // Assert
    expect(games).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('重试也失败时抛 UpstreamError，消息只有主机名', async () => {
    // Arrange
    const fetch = fakeFetch(new TypeError('fetch failed'), new TypeError('fetch failed'));

    // Act
    const error = await fetchRecentGames(ID, { key: KEY, fetch }).catch((e: unknown) => e);

    // Assert
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toBe('api.steampowered.com：fetch failed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('数据不合法时不重试，消息里没有 Key', async () => {
    // Arrange
    const fetch = fakeFetch({ response: { games: 'x' } });

    // Act
    const error = await fetchRecentGames(ID, { key: KEY, fetch }).catch((e: unknown) => e);

    // Assert
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toMatch(/^api\.steampowered\.com 返回的数据不合法（GetRecentlyPlayedGames）：/);
    expect((error as Error).message).not.toContain(KEY);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('fetchLastPlayed', () => {
  it('游戏库里的最后游玩时间（毫秒）；没有或为 0 的跳过', async () => {
    // Arrange
    const fetch = fakeFetch({
      response: {
        game_count: 3,
        games: [
          { appid: 1, playtime_forever: 10, rtime_last_played: 1727600000 },
          { appid: 2, playtime_forever: 0, rtime_last_played: 0 },
          { appid: 3, playtime_forever: 5 },
        ],
      },
    });

    // Act
    const lastPlayed = await fetchLastPlayed(ID, { key: KEY, fetch });

    // Assert
    expect(lastPlayed).toEqual(new Map([[1, 1727600000000]]));
    expect(requestOf(fetch)).toEqual({
      endpoint: 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/',
      params: { key: KEY, steamid: ID, include_played_free_games: '1', format: 'json' },
    });
  });

  it('资料不公开时是空表', async () => {
    // Act + Assert
    await expect(fetchLastPlayed(ID, { key: KEY, fetch: fakeFetch({ response: {} }) })).resolves.toEqual(new Map());
  });
});

describe('fetchPlayer', () => {
  it('昵称和正在玩的游戏', async () => {
    // Arrange
    const fetch = fakeFetch({
      response: { players: [{ steamid: ID, personaname: 'Alice', personastate: 1, gameid: '1145350', gameextrainfo: 'Hades II' }] },
    });

    // Act
    const player = await fetchPlayer(ID, { key: KEY, fetch });

    // Assert
    expect(player).toEqual({ name: 'Alice', playing: { appId: 1145350, name: 'Hades II' } });
    expect(requestOf(fetch)).toEqual({
      endpoint: 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/',
      params: { key: KEY, steamids: ID, format: 'json' },
    });
  });

  it.each([
    ['不在游戏里', { players: [{ steamid: ID, personaname: 'Alice', personastate: 0 }] }, { name: 'Alice', playing: undefined }],
    ['非 Steam 游戏没有 appid', { players: [{ steamid: ID, personaname: '', gameextrainfo: 'Mod' }] }, { name: undefined, playing: { appId: undefined, name: 'Mod' } }],
    ['账号不存在', { players: [] }, undefined],
  ])('%s', async (_name, response, expected) => {
    // Act + Assert
    await expect(fetchPlayer(ID, { key: KEY, fetch: fakeFetch({ response }) })).resolves.toEqual(expected);
  });
});

describe('resolveVanity', () => {
  it('自定义链接查到的 SteamID64', async () => {
    // Arrange
    const fetch = fakeFetch({ response: { success: 1, steamid: ID } });

    // Act
    const steamId = await resolveVanity('gabe', { key: KEY, fetch });

    // Assert
    expect(steamId).toBe(ID);
    expect(requestOf(fetch)).toEqual({
      endpoint: 'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/',
      params: { key: KEY, vanityurl: 'gabe', url_type: '1', format: 'json' },
    });
  });

  it.each([
    ['查不到', { success: 42, message: 'No match' }],
    ['查到的不是个人账号', { success: 1, steamid: '103582791429521412' }],
  ])('%s时返回 undefined', async (_name, response) => {
    // Act + Assert
    await expect(resolveVanity('gabe', { key: KEY, fetch: fakeFetch({ response }) })).resolves.toBeUndefined();
  });
});
