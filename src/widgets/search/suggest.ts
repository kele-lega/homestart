import { z } from 'astro/zod';
import { fetchJson, UpstreamError } from '../../core/http';
import { normalizeQuery } from '../../lib/fuzzy';

/**
 * 搜索联想（仅服务端）。提供方是固定列表；大多返回 OpenSearch：[关键词, [联想...], ...]，
 * Bing 的 OpenSearch 接口（osjson.aspx）已经只回 204，改用它自己格式的 qsonhs.aspx。
 * 联想来源和搜索引擎分开配置。
 */

export const SUGGEST_PROVIDERS = ['bing', 'baidu', 'yandex', 'google', 'duckduckgo', 'brave'] as const;
export type SuggestProvider = (typeof SUGGEST_PROVIDERS)[number];

interface Endpoint {
  readonly url: string;
  readonly param: string;
  readonly extra?: Readonly<Record<string, string>>;
  /** 从上游的 JSON 里取出联想词的原始列表；格式不对时抛 UpstreamError */
  readonly read: (payload: unknown) => readonly string[];
}

const OpenSearchSchema = z.tuple([z.string(), z.array(z.string())], z.unknown());

function readOpenSearch(payload: unknown): readonly string[] {
  const parsed = OpenSearchSchema.safeParse(payload);
  if (!parsed.success) throw new UpstreamError('联想接口返回的格式不符合 OpenSearch');
  return parsed.data[1];
}

/** {"AS":{"Results":[{"Suggests":[{"Txt":"..."}]}]}}；没有联想时连 Results 都没有 */
const BingSchema = z.object({
  AS: z.object({
    Results: z.array(z.object({ Suggests: z.array(z.object({ Txt: z.string() })).optional() })).optional(),
  }),
});

function readBing(payload: unknown): readonly string[] {
  const parsed = BingSchema.safeParse(payload);
  if (!parsed.success) throw new UpstreamError('Bing 联想接口返回的格式不对');
  return (parsed.data.AS.Results ?? []).flatMap((result) => result.Suggests ?? []).map((suggest) => suggest.Txt);
}

const ENDPOINTS: Readonly<Record<SuggestProvider, Endpoint>> = {
  bing: { url: 'https://api.bing.com/qsonhs.aspx', param: 'q', read: readBing },
  // ie 指定输入输出都是 UTF-8；不指定时百度按 GBK 处理
  baidu: { url: 'https://suggestion.baidu.com/su', param: 'wd', extra: { action: 'opensearch', ie: 'utf-8' }, read: readOpenSearch },
  yandex: { url: 'https://suggest.yandex.com/suggest-ff.cgi', param: 'part', read: readOpenSearch },
  // oe 指定输出编码；不指定时 Google 可能按地区返回非 UTF-8
  google: {
    url: 'https://suggestqueries.google.com/complete/search',
    param: 'q',
    extra: { client: 'firefox', oe: 'utf-8' },
    read: readOpenSearch,
  },
  duckduckgo: { url: 'https://duckduckgo.com/ac/', param: 'q', extra: { type: 'list' }, read: readOpenSearch },
  brave: { url: 'https://search.brave.com/api/suggest', param: 'q', extra: { rich: 'false' }, read: readOpenSearch },
};

const REQUEST = { timeoutMs: 2500, maxBytes: 64 * 1024 } as const;
const MAX_SUGGESTIONS = 8;
const MAX_LENGTH = 200;
/** 去重是 O(n²)，先截断，避免上游返回超长数组 */
const MAX_RAW = 50;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function suggestUrl(provider: SuggestProvider, query: string): string {
  const { url, param, extra } = ENDPOINTS[provider];
  return `${url}?${new URLSearchParams({ ...extra, [param]: query })}`;
}

/** 清洗上游给的联想词：去掉空白、控制字符、残缺的 UTF-16（浏览器无法转成网址）、重复项和与输入相同的项 */
export function cleanSuggestions(raw: readonly string[], query: string): string[] {
  const self = normalizeQuery(query);
  const cleaned = raw
    .slice(0, MAX_RAW)
    .map((text) => text.replace(CONTROL_CHARS, '').trim())
    .filter((text) => text !== '' && text.length <= MAX_LENGTH && text.isWellFormed());
  const keys = cleaned.map(normalizeQuery);
  return cleaned.filter((_, i) => keys[i] !== self && keys.indexOf(keys[i]!) === i).slice(0, MAX_SUGGESTIONS);
}

/** 按提供方的格式读出联想并清洗；格式不对时抛 UpstreamError */
export function parseSuggestions(provider: SuggestProvider, payload: unknown, query: string): string[] {
  return cleanSuggestions(ENDPOINTS[provider].read(payload), query);
}

export async function fetchSuggestions(provider: SuggestProvider, query: string): Promise<string[]> {
  return parseSuggestions(provider, await fetchJson(suggestUrl(provider, query), REQUEST), query);
}
