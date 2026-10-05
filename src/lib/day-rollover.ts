/**
 * 过零点整页刷新的判断（client/day-rollover 用）。页面按服务端的「今天」渲染，
 * 浏览器时钟可能不准：新从服务端取回的页面按渲染时刻推算服务端现在几点，不看设备时钟的日期；
 * 只有从本地缓存恢复的旧页面才只能看设备时钟，这时每个渲染日最多刷新一次，时钟再错也不会一直刷新。
 * 纯函数，不碰 DOM
 */
import { localDateKey } from './zoned-time';

/** 缓存里的页面超过这么久（或设备时钟差这么多），渲染时刻就不能再当作「刚才」 */
export const STALE_MS = 10 * 60_000;

/** sessionStorage 里记着最近一次按设备时钟刷新的是哪个渲染日 */
export const ROLLOVER_KEY = 'home:day-rollover';

export interface PageLoad {
  /** 服务端渲染页面的时刻（epoch ms） */
  readonly renderedAt: number;
  /** 脚本开始执行时的设备时钟 */
  readonly loadedAt: number;
  /** 页面来自本地缓存（历史记录、恢复会话），不是刚从服务端取回的 */
  readonly fromCache: boolean;
}

/** 怎么推算「服务端现在几点」：设备时钟加上 offset，或者只能直接用设备时钟 */
export type RolloverClock = { readonly kind: 'server'; readonly offset: number } | { readonly kind: 'device' };

export function rolloverClock({ renderedAt, loadedAt, fromCache }: PageLoad): RolloverClock {
  // 缓存里的旧页面：渲染时刻和加载时刻之间差的是缓存了多久，不是设备时钟的误差
  if (fromCache && Math.abs(loadedAt - renderedAt) > STALE_MS) return { kind: 'device' };
  return { kind: 'server', offset: renderedAt - loadedAt };
}

/** 站点时区里已经不是页面渲染的那一天了 */
export function dayChanged(today: string, timeZone: string, clock: RolloverClock, deviceNow: number): boolean {
  const now = clock.kind === 'server' ? deviceNow + clock.offset : deviceNow;
  return localDateKey(now, timeZone) !== today;
}

/** sessionStorage 里用到的两个方法 */
export interface RolloverStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 按设备时钟刷新前先占位：同一个渲染日只放行一次。
 * 存储不可用（隐私模式、配额已满）时不刷新，宁可停在旧页面也不冒一直刷新的险
 */
export function claimDeviceReload(today: string, store: () => RolloverStore): boolean {
  try {
    const storage = store();
    if (storage.getItem(ROLLOVER_KEY) === today) return false;
    storage.setItem(ROLLOVER_KEY, today);
    return true;
  } catch {
    return false;
  }
}
