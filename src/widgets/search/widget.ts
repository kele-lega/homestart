import { z } from 'astro/zod';
import { createCache } from '../../core/cache';
import { defineWidget, type WidgetAction } from '../../core/widget';
import { normalizeQuery } from '../../lib/fuzzy';
import { ENGINE_IDS } from './engines';
import { MAX_QUERY } from './options';
import { fetchSuggestions, SUGGEST_PROVIDERS } from './suggest';

const SearchOptions = z.strictObject({
  /** 可切换的搜索引擎，第一个为默认；用户切换后记在浏览器里 */
  engines: z
    .array(z.enum(ENGINE_IDS))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, '搜索引擎不能重复')
    .default([...ENGINE_IDS]),
  /** 联想来源；false 关闭联想 */
  suggest: z.union([z.enum(SUGGEST_PROVIDERS), z.literal(false)]).default('bing'),
  /** 是否同时搜索 links.yaml 里的网站 */
  sites: z.boolean().default(true),
  /** 输入框提示；{engine} 会换成当前选中的搜索引擎名称 */
  placeholder: z.string().min(1).default('搜索网站，或用 {engine} 搜索…'),
});

export type SearchOptions = z.infer<typeof SearchOptions>;

// 先规范化再限制长度：NFKC 可能把一个字符展开成十几个（例如 U+FDFA），长度要按真正发给上游的算
const SuggestQuery = z.object({
  q: z
    .string({ error: '缺少搜索内容' })
    .transform(normalizeQuery)
    .pipe(z.string().min(1, '缺少搜索内容').max(MAX_QUERY, `搜索内容不能超过 ${MAX_QUERY} 个字符`)),
});

// 按「用户 + 来源 + 规范化后的关键词」缓存：全站共享的话，响应快慢会透露别人最近搜过什么
const suggestions = createCache<readonly string[]>({ ttlMs: 10 * 60_000, maxEntries: 500 });

const suggest: WidgetAction<SearchOptions, z.infer<typeof SuggestQuery>, readonly string[]> = {
  query: SuggestQuery,
  maxAge: 300,
  // q 已由 SuggestQuery 规范化
  run: async (options, { q }, { user }) => {
    if (options.suggest === false) return [];
    const provider = options.suggest;
    const key = `${user}:${provider}:${q}`;
    return suggestions.get(key, async () => Object.freeze(await fetchSuggestions(provider, q)));
  },
};

export default defineWidget({ type: 'search', chrome: 'bare', options: SearchOptions, actions: { suggest } });
