import { z } from 'astro/zod';
import { fetchJson, UpstreamError } from '../../core/http';
import { normalizeQuery } from '../../lib/fuzzy';

/**
 * 搜索联想（仅服务端）。提供方同样是固定列表，返回格式都是 OpenSearch：[关键词, [联想...], ...]。
 * 联想来源和搜索引擎分开配置：国内网络下只有 Bing 的联想接口稳定可达。
 */

export const SUGGEST_PROVIDERS = ['bing', 'duckduckgo', 'brave', 'google'] as const;
export type SuggestProvider = (typeof SUGGEST_PROVIDERS)[number];

interface Endpoint {
  readonly url: string;
  readonly param: string;
  readonly extra?: Readonly<Record<string, string>>;
}

const ENDPOINTS: Readonly<Record<SuggestProvider, Endpoint>> = {
  bing: { url: 'https://api.bing.com/osjson.aspx', param: 'query' },
  duckduckgo: { url: 'https://duckduckgo.com/ac/', param: 'q', extra: { type: 'list' } },
  brave: { url: 'https://search.brave.com/api/suggest', param: 'q', extra: { rich: 'false' } },
  // oe 指定输出编码；不指定时 Google 可能按地区返回非 UTF-8
  google: { url: 'https://suggestqueries.google.com/complete/search', param: 'q', extra: { client: 'firefox', oe: 'utf-8' } },
};

const REQUEST = { timeoutMs: 2500, maxBytes: 64 * 1024 } as const;
const MAX_SUGGESTIONS = 8;
const MAX_LENGTH = 200;
/** 去重是 O(n²)，先截断，避免上游返回超长数组 */
const MAX_RAW = 50;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const OpenSearchSchema = z.tuple([z.string(), z.array(z.string())], z.unknown());

export function suggestUrl(provider: SuggestProvider, query: string): string {
  const { url, param, extra } = ENDPOINTS[provider];
  return `${url}?${new URLSearchParams({ ...extra, [param]: query })}`;
}

/** 校验并清洗上游数据：去掉空白、控制字符、残缺的 UTF-16（浏览器无法转成网址）、重复项和与输入相同的项 */
export function parseSuggestions(payload: unknown, query: string): string[] {
  const parsed = OpenSearchSchema.safeParse(payload);
  if (!parsed.success) throw new UpstreamError('联想接口返回的格式不符合 OpenSearch');
  const [, raw] = parsed.data;
  const self = normalizeQuery(query);
  const cleaned = raw
    .slice(0, MAX_RAW)
    .map((text) => text.replace(CONTROL_CHARS, '').trim())
    .filter((text) => text !== '' && text.length <= MAX_LENGTH && text.isWellFormed());
  const keys = cleaned.map(normalizeQuery);
  return cleaned.filter((_, i) => keys[i] !== self && keys.indexOf(keys[i]!) === i).slice(0, MAX_SUGGESTIONS);
}

export async function fetchSuggestions(provider: SuggestProvider, query: string): Promise<string[]> {
  return parseSuggestions(await fetchJson(suggestUrl(provider, query), REQUEST), query);
}
