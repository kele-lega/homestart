/**
 * 本站的两个计数：有人通过本站点开一个网站（导航）、用搜索框搜索一次（搜索）就各加一，不分登录与否。
 * 这里是服务端和浏览器都要用的形状和调用；存储在 adapters/site-stats。这个模块会进浏览器，不能引用服务端代码
 */
import { jsonHeaders } from './widget-api';

export const HIT_KINDS = ['nav', 'search'] as const;
export type HitKind = (typeof HIT_KINDS)[number];

export type SiteCounts = Readonly<Record<HitKind, number>>;

export const ZERO_COUNTS: SiteCounts = { nav: 0, search: 0 };

export const SITE_STATS_URL = '/api/site/stats';
/** 实时推送（Server-Sent Events），每条 data 是一份 SiteCounts */
export const SITE_STREAM_URL = '/api/site/stream';

export function isHitKind(value: unknown): value is HitKind {
  return typeof value === 'string' && (HIT_KINDS as readonly string[]).includes(value);
}

/** 接口里的计数；形状不对时 undefined */
export function readCounts(value: unknown): SiteCounts | undefined {
  const counts = value as Partial<Record<HitKind, unknown>> | null;
  if (typeof counts !== 'object' || counts === null) return undefined;
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return valid(counts.nav) && valid(counts.search) ? { nav: counts.nav, search: counts.search } : undefined;
}

/**
 * 两份计数取各自较大的：本页先乐观地加了一，服务端的回执、轮询的结果晚到时不会把数字翻回去。
 * 计数只增不减；文件被手动清零后，开着的页面刷新一次才跟上
 */
export function mergeCounts(a: SiteCounts, b: SiteCounts): SiteCounts {
  return { nav: Math.max(a.nav, b.nav), search: Math.max(a.search, b.search) };
}

export function bump(counts: SiteCounts, kind: HitKind): SiteCounts {
  return { ...counts, [kind]: counts[kind] + 1 };
}

async function call(init: RequestInit): Promise<SiteCounts | undefined> {
  try {
    const response = await fetch(SITE_STATS_URL, init);
    const envelope = (await response.json()) as { success?: unknown; data?: unknown };
    return envelope.success === true ? readCounts(envelope.data) : undefined;
  } catch {
    return undefined;
  }
}

export const fetchCounts = (signal?: AbortSignal) => call({ headers: jsonHeaders('GET'), signal });

/** keepalive：点开网站的同时当前页恰好被关掉，这一次照样记上 */
export const reportHit = (kind: HitKind) =>
  call({ method: 'POST', headers: jsonHeaders('POST'), body: JSON.stringify({ kind }), keepalive: true });
