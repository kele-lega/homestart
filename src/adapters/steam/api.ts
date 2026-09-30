import { z } from 'astro/zod';
import { formatIssues } from '../../core/config-error';
import { fetchJson, UpstreamError, type FetchJsonOptions } from '../../core/http';
import type { SteamGame, SteamPlayer } from './model';
import { isSteamId64 } from './steam-id';

/**
 * Steam Web API（https://partner.steamgames.com/doc/webapi_overview，需要 API Key）。只负责请求和校验。
 * Key 在查询字符串里：请求地址不进日志也不进错误消息，fetchJson 的错误只带主机名。
 * 国内直连时 api.steampowered.com 偶尔握手挂起、重试一次就好，所以网络错误重试一次；HTTP 错误不重试。
 */

const ENDPOINT = 'https://api.steampowered.com';
const HOST = 'api.steampowered.com';
// 实测正常时 1 秒内；挂起时等满 4 秒再重试一次，骨架屏最多等 8 秒
const TIMEOUT_MS = 4000;
/** 游戏库可能有几千款游戏，其余接口都很小 */
const MAX_BYTES = { small: 64 * 1024, library: 4 * 1024 * 1024 } as const;

export interface SteamApiOptions {
  readonly key: string;
  /** 测试时注入 */
  readonly fetch?: typeof fetch;
}

/** 最近游玩接口给的部分；最后游玩时间要另外从游戏库里取 */
export type RecentGame = Omit<SteamGame, 'lastPlayedAt'>;

async function call<S extends z.ZodType>(
  method: string,
  params: Readonly<Record<string, string>>,
  schema: S,
  options: SteamApiOptions & { readonly maxBytes: number },
): Promise<z.output<S>> {
  const url = `${ENDPOINT}/${method}/?${new URLSearchParams({ key: options.key, ...params, format: 'json' })}`;
  const fetchOptions: FetchJsonOptions = {
    timeoutMs: TIMEOUT_MS,
    maxBytes: options.maxBytes,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  let data: unknown;
  try {
    data = await fetchJson(url, fetchOptions);
  } catch (error) {
    // 有状态码说明 Steam 已经回应，重试也一样；没有的是超时、连接失败或偶发的非 JSON 内容
    if (!(error instanceof UpstreamError) || error.status !== undefined) throw error;
    data = await fetchJson(url, fetchOptions);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const name = method.split('/')[1];
    throw new UpstreamError(`${HOST} 返回的数据不合法（${name}）：${formatIssues(parsed.error.issues).join('；')}`);
  }
  return parsed.data;
}

const Minutes = z.number().int().nonnegative().optional();

const RecentResponse = z.object({
  response: z.object({
    // 资料不公开时 response 是空对象；公开但两周没玩时只有 total_count: 0
    total_count: z.number().int().nonnegative().optional(),
    games: z
      .array(z.object({ appid: z.number().int().positive(), name: z.string().optional(), playtime_2weeks: Minutes, playtime_forever: Minutes }))
      .optional(),
  }),
});

/** 最近两周玩过的游戏，按 Steam 给的顺序；游戏详情不公开时返回 undefined */
export async function fetchRecentGames(steamId: string, options: SteamApiOptions): Promise<RecentGame[] | undefined> {
  const { response } = await call('IPlayerService/GetRecentlyPlayedGames/v1', { steamid: steamId }, RecentResponse, {
    ...options,
    maxBytes: MAX_BYTES.small,
  });
  if (response.total_count === undefined && response.games === undefined) return undefined;
  return (response.games ?? []).map((game) => ({
    appId: game.appid,
    name: game.name?.trim() || `App ${game.appid}`,
    recentMinutes: game.playtime_2weeks ?? 0,
    totalMinutes: game.playtime_forever ?? 0,
  }));
}

const OwnedResponse = z.object({
  response: z.object({
    games: z.array(z.object({ appid: z.number().int().positive(), rtime_last_played: z.number().int().nonnegative().optional() })).optional(),
  }),
});

/** 游戏库里每款游戏的最后游玩时间（毫秒）。Steam 对部分账号不给这一项，没有的就不在表里 */
export async function fetchLastPlayed(steamId: string, options: SteamApiOptions): Promise<Map<number, number>> {
  const { response } = await call(
    'IPlayerService/GetOwnedGames/v1',
    { steamid: steamId, include_played_free_games: '1' },
    OwnedResponse,
    { ...options, maxBytes: MAX_BYTES.library },
  );
  const entries = (response.games ?? [])
    .filter((game) => game.rtime_last_played)
    .map((game) => [game.appid, game.rtime_last_played! * 1000] as const);
  return new Map(entries);
}

const SummariesResponse = z.object({
  response: z.object({
    players: z.array(
      z.object({ steamid: z.string(), personaname: z.string().optional(), gameid: z.string().optional(), gameextrainfo: z.string().optional() }),
    ),
  }),
});

function appIdOf(gameId: string | undefined): number | undefined {
  // 非 Steam 游戏的 gameid 是超出安全整数的大数，没有商店页和封面
  const id = Number(gameId);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** 昵称和正在玩的游戏；账号不存在时返回 undefined */
export async function fetchPlayer(steamId: string, options: SteamApiOptions): Promise<SteamPlayer | undefined> {
  const { response } = await call('ISteamUser/GetPlayerSummaries/v2', { steamids: steamId }, SummariesResponse, {
    ...options,
    maxBytes: MAX_BYTES.small,
  });
  const player = response.players.find((p) => p.steamid === steamId);
  if (!player) return undefined;
  const game = player.gameextrainfo?.trim();
  return {
    name: player.personaname?.trim() || undefined,
    playing: game ? { appId: appIdOf(player.gameid), name: game } : undefined,
  };
}

const VanityResponse = z.object({
  response: z.object({ success: z.number().int(), steamid: z.string().optional() }),
});

/** 自定义链接里的名字 → SteamID64；查不到或查到的不是个人账号时返回 undefined */
export async function resolveVanity(name: string, options: SteamApiOptions): Promise<string | undefined> {
  const { response } = await call('ISteamUser/ResolveVanityURL/v1', { vanityurl: name, url_type: '1' }, VanityResponse, {
    ...options,
    maxBytes: MAX_BYTES.small,
  });
  return response.success === 1 && response.steamid && isSteamId64(response.steamid) ? response.steamid : undefined;
}
