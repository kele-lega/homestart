/**
 * 本地网站搜索用的轻量模糊匹配。条目只有几十上百个，每次按键全量打分即可，不需要索引。
 * 打分从高到低：完全相同 > 前缀 > 词首 > 子串（越靠前越高）> 名称/关键词的分散子序列。
 */

export interface SearchEntry {
  readonly name: string;
  readonly url: string;
  /** 去掉 www. 的主机名，允许用域名搜索 */
  readonly host: string;
  readonly keywords: readonly string[];
  readonly favorite: boolean;
}

const SCORE = { exact: 100, prefix: 80, wordStart: 65, substring: 50, subsequence: 20 } as const;
const FIELD_WEIGHT = { name: 1, keyword: 0.9, host: 0.75 } as const;
const WORD_BOUNDARY = /[\s\-_./·]/;

export function normalizeQuery(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim();
}

/** 查询的每个字符按顺序出现在文本中；字符越集中分越高 */
function subsequenceScore(query: string, text: string): number {
  let from = 0;
  let first = -1;
  for (const char of query) {
    const index = text.indexOf(char, from);
    if (index === -1) return 0;
    if (first === -1) first = index;
    from = index + char.length;
  }
  return SCORE.subsequence + (10 * query.length) / (from - first);
}

function textScore(query: string, text: string, allowSubsequence: boolean): number {
  if (text === query) return SCORE.exact;
  if (text.startsWith(query)) return SCORE.prefix;
  const index = text.indexOf(query);
  if (index > 0) {
    return WORD_BOUNDARY.test(text[index - 1]!) ? SCORE.wordStart : SCORE.substring - Math.min(index, 10);
  }
  return allowSubsequence && query.length > 1 ? subsequenceScore(query, text) : 0;
}

function entryScore(query: string, entry: SearchEntry): number {
  const keywordScores = entry.keywords.map((k) => textScore(query, normalizeQuery(k), true));
  return Math.max(
    textScore(query, normalizeQuery(entry.name), true) * FIELD_WEIGHT.name,
    ...keywordScores.map((score) => score * FIELD_WEIGHT.keyword),
    textScore(query, entry.host, false) * FIELD_WEIGHT.host,
  );
}

/** 前缀级别的匹配（host 完全相同也算）。搜索框只在这种情况下默认选中网站，否则回车走外部搜索 */
const STRONG_MATCH = 70;

export function isStrongMatch(query: string, entry: SearchEntry): boolean {
  const needle = normalizeQuery(query);
  return needle !== '' && entryScore(needle, entry) >= STRONG_MATCH;
}

/** 按匹配度排序返回前 limit 条；同分时常用网站优先，其次保持配置顺序 */
export function searchEntries<T extends SearchEntry>(query: string, entries: readonly T[], limit = 6): T[] {
  const needle = normalizeQuery(query);
  if (needle === '') return [];
  return entries
    .map((entry, order) => ({ entry, order, score: entryScore(needle, entry) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.entry.favorite) - Number(a.entry.favorite) || a.order - b.order)
    .slice(0, limit)
    .map((item) => item.entry);
}
