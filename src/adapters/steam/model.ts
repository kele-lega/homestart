/**
 * Steam 数据的标准模型：与接口字段、界面都无关。浏览器端（Steam.svelte）也只引用这里的类型
 */

export interface SteamGame {
  readonly appId: number;
  readonly name: string;
  /** 最近两周的游玩分钟数 */
  readonly recentMinutes: number;
  /** 累计游玩分钟数 */
  readonly totalMinutes: number;
  /** 最后游玩时间（毫秒）；Steam 不一定给，没有时为 undefined */
  readonly lastPlayedAt: number | undefined;
}

export interface SteamPlayer {
  /** 昵称；空的时候为 undefined */
  readonly name: string | undefined;
  /** 正在玩的游戏；不在游戏里或资料不公开时为 undefined。非 Steam 游戏没有 appId */
  readonly playing: { readonly appId: number | undefined; readonly name: string } | undefined;
}

export type SteamFeed =
  /** 服务器没有配置 API Key */
  | { readonly status: 'nokey' }
  /** 当前用户没有绑定 Steam 账号 */
  | { readonly status: 'unbound' }
  /** 游戏详情不公开，拿不到游玩记录 */
  | { readonly status: 'hidden' }
  | { readonly status: 'error'; readonly message: string }
  /** stale：Steam 暂时连不上，games 是之前取到的 */
  | { readonly status: 'ok'; readonly games: readonly SteamGame[]; readonly stale: boolean };

export interface SteamSnapshot {
  /** 当前用户绑定的 SteamID64 */
  readonly steamId: string | undefined;
  /** 读不到（没绑定、没配 Key、Steam 连不上）时为 undefined */
  readonly player: SteamPlayer | undefined;
  readonly feed: SteamFeed;
}

export interface SteamBinding {
  readonly steamId: string | undefined;
}
