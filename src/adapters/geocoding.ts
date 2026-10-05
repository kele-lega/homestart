import { z } from 'astro/zod';
import { formatIssues } from '../core/config-error';
import { fetchJson, UpstreamError, type FetchJsonOptions } from '../core/http';
import { logBackgroundError } from '../core/log';

/**
 * 地名搜索，设置页选天气地区用：输入地名，返回几个候选地点和坐标。两家一起查、合并去重：
 *   OpenStreetMap Nominatim（https://nominatim.org/release-docs/latest/api/Search/）：中国的区县、县级市收得全，排在前面
 *   Open-Meteo（https://open-meteo.com/en/docs/geocoding-api，和天气是同一家）：中文地名常常要和库里一字不差，
 *     「清远」搜不到、「清远市」才行，很多县级市干脆没有；国外地名不错，作为补充
 * 两家都不需要 Key。一家出错时只用另一家的结果；两家都出错才算失败
 */

const OPEN_METEO = 'https://geocoding-api.open-meteo.com/v1/search';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const LIMITS = { timeoutMs: 5000, maxBytes: 64 * 1024 } as const;
// Nominatim 的使用规定要求带上能认出应用的 User-Agent；只在用户点「搜索」时请求，远低于每秒一次的上限
const NOMINATIM_HEADERS = { 'user-agent': 'homestart/1.0 (personal homepage; weather place search)' } as const;
export const MAX_PLACES = 8;
export const MAX_PLACE_QUERY = 60;
/** 两家给的同一个地方，坐标差不出这么多（约 10 公里） */
const SAME_PLACE_DEGREES = 0.1;

export interface Place {
  readonly name: string;
  /** 「深圳 · 广东 · 中国」这样的上级区划，帮着分辨同名的地方 */
  readonly region: string;
  readonly latitude: number;
  readonly longitude: number;
}

/** 上级区划从小到大连起来，跳过和地名相同的、重复的（直辖市的两级都是「重庆市」） */
function joinRegion(name: string, parts: readonly (string | undefined)[]): string {
  const kept = parts.filter((part): part is string => !!part && part !== name);
  return [...new Set(kept)].join(' · ');
}

// ---- Open-Meteo

const MeteoResult = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  admin2: z.string().optional(),
  admin1: z.string().optional(),
  country: z.string().optional(),
});

// 一个都没搜到时没有 results 这个键
const MeteoResponse = z.object({ results: z.array(z.unknown()).optional() });

async function searchOpenMeteo(query: string, lang: string, fetchOptions: FetchJsonOptions): Promise<readonly Place[]> {
  const params = new URLSearchParams({
    name: query,
    count: String(MAX_PLACES),
    // zh-CN → zh：地名用中文
    language: lang.split('-')[0]!,
    format: 'json',
  });
  const parsed = MeteoResponse.safeParse(await fetchJson(`${OPEN_METEO}?${params}`, fetchOptions));
  if (!parsed.success) {
    throw new UpstreamError(`geocoding-api.open-meteo.com 返回的数据不合法：${formatIssues(parsed.error.issues).join('；')}`);
  }
  // 逐条校验：个别条目缺字段时丢掉那一条，不让整次搜索失败
  return (parsed.data.results ?? []).flatMap((item) => {
    const result = MeteoResult.safeParse(item);
    if (!result.success) return [];
    const { name, latitude, longitude, admin2, admin1, country } = result.data;
    return [{ name, region: joinRegion(name, [admin2, admin1, country]), latitude, longitude }];
  });
}

// ---- Nominatim

const Coordinate = z.coerce.number().refine(Number.isFinite);

const NominatimResult = z.object({
  name: z.string(),
  // 行政区（boundary）和居民点（place）；车站、山峰之类不要
  category: z.enum(['boundary', 'place']),
  lat: Coordinate,
  lon: Coordinate,
  address: z.record(z.string(), z.string()).default({}),
});

/** 从小到大的上级区划；中国的地级市在 city，区县在 county / district，省在 state */
const NOMINATIM_LEVELS = ['district', 'county', 'city', 'region', 'state', 'country'] as const;

async function searchNominatim(query: string, lang: string, fetchOptions: FetchJsonOptions): Promise<readonly Place[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(MAX_PLACES),
    'accept-language': lang,
    addressdetails: '1',
    // 只要地址类的结果（行政区、城镇村），不要商店、车站
    layer: 'address',
  });
  const raw = await fetchJson(`${NOMINATIM}?${params}`, { ...fetchOptions, headers: NOMINATIM_HEADERS });
  if (!Array.isArray(raw)) throw new UpstreamError('nominatim.openstreetmap.org 返回的数据不合法：不是列表');
  return raw.flatMap((item) => {
    const result = NominatimResult.safeParse(item);
    if (!result.success || result.data.name.trim() === '') return [];
    const { name, lat, lon, address } = result.data;
    return [{ name, region: joinRegion(name, NOMINATIM_LEVELS.map((level) => address[level])), latitude: lat, longitude: lon }];
  });
}

// ---- 合并

const samePlace = (a: Place, b: Place) =>
  Math.abs(a.latitude - b.latitude) < SAME_PLACE_DEGREES && Math.abs(a.longitude - b.longitude) < SAME_PLACE_DEGREES;

/** 按顺序合并，后面的和前面某个是同一个地方时丢掉 */
export function mergePlaces(...lists: readonly (readonly Place[])[]): readonly Place[] {
  const merged: Place[] = [];
  for (const place of lists.flat()) {
    if (!merged.some((kept) => samePlace(kept, place))) merged.push(place);
  }
  return merged.slice(0, MAX_PLACES);
}

export interface PlaceSearchOptions {
  readonly lang?: string;
  /** 测试时注入 */
  readonly fetch?: typeof fetch;
}

export async function searchPlaces(query: string, options: PlaceSearchOptions = {}): Promise<readonly Place[]> {
  const lang = options.lang ?? 'zh-CN';
  const fetchOptions: FetchJsonOptions = options.fetch ? { ...LIMITS, fetch: options.fetch } : LIMITS;
  const [nominatim, meteo] = await Promise.allSettled([
    searchNominatim(query, lang, fetchOptions),
    searchOpenMeteo(query, lang, fetchOptions),
  ]);
  if (nominatim.status === 'rejected' && meteo.status === 'rejected') throw nominatim.reason;
  // 只挂了一家：照样给出另一家的结果，记一笔日志
  for (const [source, settled] of [
    ['Nominatim', nominatim],
    ['Open-Meteo', meteo],
  ] as const) {
    if (settled.status === 'rejected') logBackgroundError('geocoding', `${source} 地名搜索失败，只用另一家的结果`, settled.reason);
  }
  const ok = (settled: PromiseSettledResult<readonly Place[]>) => (settled.status === 'fulfilled' ? settled.value : []);
  return mergePlaces(ok(nominatim), ok(meteo));
}
