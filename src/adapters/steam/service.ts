/**
 * Steam 服务：读用户绑定的 SteamID64 → 最近两周玩过的游戏（附最后游玩时间）+ 昵称和正在玩的游戏。
 * 每个用户一组缓存：
 *   游戏 15 分钟新鲜；过期后先返回旧数据、后台刷新，刷新失败时继续用旧数据并标记 stale，最多 24 小时；
 *   昵称和在线状态 2 分钟新鲜，再陈旧 8 分钟；读不到就不显示，不影响游戏列表。
 *   失败不缓存，下次请求重新请求 Steam。
 * API Key 只从服务端环境变量 STEAM_API_KEY 读，每次现读；日志里只有主机名和原因，没有请求地址。
 */
import { ANONYMOUS } from '../../core/api';
import { createCache, type Cache } from '../../core/cache';
import { UpstreamError } from '../../core/http';
import { logBackgroundError } from '../../core/log';
import { ActionInputError } from '../../core/widget';
import * as steamApi from './api';
import type { SteamApiOptions } from './api';
import type { SteamBinding, SteamFeed, SteamGame, SteamPlayer, SteamSnapshot } from './model';
import { parseSteamInput } from './steam-id';
import { createSteamStore } from './store';
import type { UserStore } from '../user-store';

export interface SteamService {
  getSteamSnapshot(user: string, options?: { readonly signal?: AbortSignal }): Promise<SteamSnapshot>;
  /** 填的内容不合格或查不到时抛 ActionInputError（中文说明） */
  bindSteamAccount(user: string, input: string): Promise<SteamBinding>;
  unbindSteamAccount(user: string): Promise<SteamBinding>;
}

export type SteamApi = Pick<typeof steamApi, 'fetchRecentGames' | 'fetchLastPlayed' | 'fetchPlayer' | 'resolveVanity'>;

export interface SteamServiceDeps {
  readonly store?: UserStore;
  /** 测试时注入，不碰真实网络 */
  readonly api?: SteamApi;
  /** 默认每次读环境变量 STEAM_API_KEY */
  readonly apiKey?: () => string | undefined;
  /** 缓存用的单调时钟 */
  readonly now?: () => number;
}

const GAMES_FRESH_MS = 15 * 60_000;
const GAMES_STALE_MS = 24 * 3_600_000;
const PLAYER_FRESH_MS = 2 * 60_000;
const PLAYER_STALE_MS = 8 * 60_000;
const API_KEY = /^[0-9a-f]{32}$/i;

/** 游戏详情不公开时 games 为 undefined */
interface Games {
  readonly games: readonly SteamGame[] | undefined;
}

/** 一个用户当前绑定账号的缓存；换绑就换一个新的 */
interface Slot {
  readonly steamId: string;
  readonly games: Cache<Games>;
  readonly player: Cache<SteamPlayer | undefined>;
  /** 最近一次后台刷新游戏失败、正在用旧数据 */
  readonly state: { failed: boolean };
}

function requireUser(user: string): void {
  if (user === ANONYMOUS) throw new ActionInputError('未登录，无法保存 Steam 设置');
}

/** 显示给用户的失败原因；详细原因（只有主机名）在日志里 */
function failureMessage(error: UpstreamError): string {
  if (error.status === 401 || error.status === 403) return 'Steam 拒绝了服务器配置的 API Key';
  if (error.status === 429) return 'Steam 请求太频繁，稍后再试';
  return '暂时连不上 Steam，稍后再试';
}

function createSlot(steamId: string, now: () => number): Slot {
  const state = { failed: false };
  // 失败原因已在加载时记过，这里只标记正在用旧数据
  const games = createCache<Games>({
    ttlMs: GAMES_FRESH_MS,
    maxEntries: 1,
    now,
    stale: {
      ms: GAMES_STALE_MS,
      onError: () => {
        state.failed = true;
      },
    },
  });
  const player = createCache<SteamPlayer | undefined>({
    ttlMs: PLAYER_FRESH_MS,
    maxEntries: 1,
    now,
    stale: { ms: PLAYER_STALE_MS, onError: () => undefined },
  });
  return { steamId, games, player, state };
}

export function createSteamService(deps: SteamServiceDeps = {}): SteamService {
  const { store = createSteamStore(), api = steamApi, apiKey = () => process.env.STEAM_API_KEY, now = () => performance.now() } = deps;
  const slots = new Map<string, Slot>();
  let warnedBadKey = false;

  /** 格式不对的 Key 按没配处理：Steam 一定会拒绝，没必要每次都去请求 */
  function currentKey(): string | undefined {
    const key = apiKey()?.trim();
    if (!key) return undefined;
    if (API_KEY.test(key)) return key;
    if (!warnedBadKey) console.warn('[steam] 环境变量 STEAM_API_KEY 不是 32 位十六进制，按没有配置处理');
    warnedBadKey = true;
    return undefined;
  }

  function slotFor(user: string, steamId: string): Slot {
    const existing = slots.get(user);
    if (existing?.steamId === steamId) return existing;
    const slot = createSlot(steamId, now);
    slots.set(user, slot);
    return slot;
  }

  async function loadGames(slot: Slot, user: string, options: SteamApiOptions): Promise<Games> {
    const lastPlayed = api.fetchLastPlayed(slot.steamId, options).catch((error: unknown) => {
      // 最后游玩时间只是悬停时的一行小字：读不到就不显示
      if (!(error instanceof UpstreamError)) throw error;
      logBackgroundError('steam', `${user} 的游戏库读取失败，先不显示最后游玩时间`, error);
      return new Map<number, number>();
    });
    try {
      const [recent, dates] = await Promise.all([api.fetchRecentGames(slot.steamId, options), lastPlayed]);
      slot.state.failed = false;
      const games = recent?.map((game) => ({ ...game, lastPlayedAt: dates.get(game.appId) }));
      return { games };
    } catch (error) {
      logBackgroundError('steam', `${user} 的最近游玩读取失败`, error);
      throw error;
    }
  }

  async function loadPlayer(slot: Slot, user: string, options: SteamApiOptions): Promise<SteamPlayer | undefined> {
    try {
      return await api.fetchPlayer(slot.steamId, options);
    } catch (error) {
      logBackgroundError('steam', `${user} 的 Steam 资料读取失败`, error);
      throw error;
    }
  }

  async function readFeed(slot: Slot, user: string, options: SteamApiOptions): Promise<SteamFeed> {
    try {
      const { games } = await slot.games.get('games', () => loadGames(slot, user, options));
      return games ? { status: 'ok', games, stale: slot.state.failed } : { status: 'hidden' };
    } catch (error) {
      if (error instanceof UpstreamError) return { status: 'error', message: failureMessage(error) };
      throw error;
    }
  }

  async function readPlayer(slot: Slot, user: string, options: SteamApiOptions): Promise<SteamPlayer | undefined> {
    try {
      return await slot.player.get('player', () => loadPlayer(slot, user, options));
    } catch (error) {
      // 昵称和在线状态只是附带的：读不到就不显示，原因已在加载时记过
      if (error instanceof UpstreamError) return undefined;
      throw error;
    }
  }

  async function resolveInput(input: string): Promise<string> {
    const parsed = parseSteamInput(input);
    if (parsed.kind === 'invalid') throw new ActionInputError(parsed.message);
    if (parsed.kind === 'id') return parsed.steamId;
    const key = currentKey();
    if (!key) throw new ActionInputError('服务器没有配置 Steam API Key，请直接填 17 位 SteamID64');
    let steamId: string | undefined;
    try {
      steamId = await api.resolveVanity(parsed.name, { key });
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      logBackgroundError('steam', '自定义链接查询失败', error);
      throw new ActionInputError('暂时连不上 Steam，查不了自定义链接；可以直接填 17 位 SteamID64');
    }
    if (!steamId) throw new ActionInputError('找不到这个自定义链接，请检查拼写，或直接填 17 位 SteamID64');
    return steamId;
  }

  return {
    async getSteamSnapshot(user, options = {}) {
      options.signal?.throwIfAborted();
      const steamId = user === ANONYMOUS ? undefined : await store.get(user);
      const key = currentKey();
      if (!key) return { steamId, player: undefined, feed: { status: 'nokey' } };
      if (!steamId) return { steamId, player: undefined, feed: { status: 'unbound' } };
      const slot = slotFor(user, steamId);
      const [feed, player] = await Promise.all([readFeed(slot, user, { key }), readPlayer(slot, user, { key })]);
      return { steamId, player, feed };
    },
    async bindSteamAccount(user, input) {
      requireUser(user);
      const steamId = await resolveInput(input);
      await store.put(user, steamId);
      slots.delete(user);
      return { steamId };
    },
    async unbindSteamAccount(user) {
      requireUser(user);
      await store.put(user, undefined);
      slots.delete(user);
      return { steamId: undefined };
    },
  };
}

const defaultService = createSteamService();

export const { getSteamSnapshot, bindSteamAccount, unbindSteamAccount } = defaultService;
