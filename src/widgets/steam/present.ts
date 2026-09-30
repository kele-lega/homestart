import type { SteamGame } from '../../adapters/steam/model';
import { diffDays, localDateKey, parseDateKey, weekdayOf } from '../../lib/zoned-time';

/** Steam：最近两周玩过的游戏，正在玩的排在最前，其余按最后游玩时间新的在前 */

export interface GameRow {
  readonly appId: number;
  readonly name: string;
  readonly cover: string;
  /** 「今天 · 2.3 小时」「近两周 2.3 小时」 */
  readonly meta: string;
  /** 「累计 812 小时 · 上次 09月29日」 */
  readonly detail: string;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_DAYS = 6;

export function coverUrl(appId: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_184x69.jpg`;
}

/** 100 小时以下留一位小数，往上取整（与原型一致） */
export function hoursText(minutes: number): string {
  const hours = minutes / 60;
  return hours >= 100 ? `${Math.round(hours)} 小时` : `${hours.toFixed(1)} 小时`;
}

function dayLabel(dateKey: string, today: string): string {
  const days = diffDays(dateKey, today);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days <= WEEK_DAYS) return WEEKDAYS[weekdayOf(dateKey)]!;
  const { month, day } = parseDateKey(dateKey)!;
  return `${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;
}

function metaText(game: SteamGame, today: string, timeZone: string): string {
  const hours = hoursText(game.recentMinutes);
  if (game.lastPlayedAt === undefined) return `近两周 ${hours}`;
  return `${dayLabel(localDateKey(game.lastPlayedAt, timeZone), today)} · ${hours}`;
}

export function gameDetail(game: SteamGame, timeZone: string): string {
  const total = `累计 ${hoursText(game.totalMinutes)}`;
  if (game.lastPlayedAt === undefined) return total;
  const { month, day } = parseDateKey(localDateKey(game.lastPlayedAt, timeZone))!;
  return `${total} · 上次 ${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;
}

export interface GameRowsOptions {
  readonly now: number;
  readonly timeZone: string;
  readonly count: number;
  /** 正在玩的游戏的 appId；排在最前 */
  readonly playingAppId?: number | undefined;
}

export function gameRows(games: readonly SteamGame[], { now, timeZone, count, playingAppId }: GameRowsOptions): readonly GameRow[] {
  const today = localDateKey(now, timeZone);
  const withRank = games.map((game, index) => ({ game, index }));
  const sorted = [...withRank].sort((a, b) => {
    const aPlaying = a.game.appId === playingAppId ? 0 : 1;
    const bPlaying = b.game.appId === playingAppId ? 0 : 1;
    if (aPlaying !== bPlaying) return aPlaying - bPlaying;
    if (a.game.lastPlayedAt !== undefined && b.game.lastPlayedAt !== undefined) {
      return b.game.lastPlayedAt - a.game.lastPlayedAt;
    }
    if (a.game.lastPlayedAt !== undefined) return -1;
    if (b.game.lastPlayedAt !== undefined) return 1;
    return a.index - b.index;
  });
  return sorted.slice(0, count).map(({ game }) => ({
    appId: game.appId,
    name: game.name,
    cover: coverUrl(game.appId),
    meta: metaText(game, today, timeZone),
    detail: gameDetail(game, timeZone),
  }));
}
