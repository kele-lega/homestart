import type { SteamSnapshot } from '../../adapters/steam/model';
import { getSteamSnapshot } from '../../adapters/steam/service';
import type { WidgetContext } from '../../core/widget';
import { gameRows, type GameRow } from './present';

/** recent 操作返回给浏览器的全部数据：账号、栏目头补充说明、游戏列表（或未绑定/无 Key/隐藏/出错） */
export interface SteamView {
  readonly account: { readonly steamId: string; readonly name: string | undefined } | undefined;
  /** 「正在玩 荒野大镖客2」或「最近游玩」 */
  readonly sub: string;
  readonly feed:
    | { readonly status: 'nokey' }
    | { readonly status: 'unbound' }
    | { readonly status: 'hidden' }
    | { readonly status: 'error'; readonly message: string }
    | { readonly status: 'ok'; readonly rows: readonly GameRow[]; readonly stale: boolean };
}

function subText(snapshot: SteamSnapshot): string {
  const playing = snapshot.player?.playing;
  return playing ? `正在玩 ${playing.name}` : '最近游玩';
}

export function toSteamView(snapshot: SteamSnapshot, count: number, now: number, timeZone: string): SteamView {
  const account = snapshot.steamId ? { steamId: snapshot.steamId, name: snapshot.player?.name } : undefined;
  const sub = subText(snapshot);
  if (snapshot.feed.status !== 'ok') return { account, sub, feed: snapshot.feed };
  const rows = gameRows(snapshot.feed.games, { now, timeZone, count, playingAppId: snapshot.player?.playing?.appId });
  return { account, sub, feed: { status: 'ok', rows, stale: snapshot.feed.stale } };
}

export async function loadSteamView(count: number, { user, signal, site }: WidgetContext): Promise<SteamView> {
  const snapshot = await getSteamSnapshot(user, { signal });
  return toSteamView(snapshot, count, Date.now(), site.timezone);
}
