import { isStrongMatch, normalizeQuery, searchEntries } from '../../lib/fuzzy';
import { ENGINES, searchUrl, type EngineId } from './engines';
import type { SiteEntry } from './sites';

/**
 * 搜索面板的纯逻辑（浏览器端使用，不能引用服务端模块）。
 * 面板顺序固定：匹配的网站 → 用搜索引擎搜索输入内容 → 联想词。
 */

export type SearchOption =
  | { readonly kind: 'site'; readonly key: string; readonly site: SiteEntry }
  | { readonly kind: 'web'; readonly key: 'web'; readonly text: string }
  | { readonly kind: 'suggest'; readonly key: string; readonly text: string };

export const MAX_SITES = 5;
export const MAX_SUGGESTIONS = 5;
/** 联想接口接受的最长关键词，超出时前端不再请求 */
export const MAX_QUERY = 100;

/** 与服务端的校验一致：规范化之后再看是否为空、是否超长，免得发出注定 400 的请求 */
export function isSuggestable(text: string): boolean {
  const normalized = normalizeQuery(text);
  return normalized !== '' && normalized.length <= MAX_QUERY;
}

export function buildOptions(
  query: string,
  sites: readonly SiteEntry[],
  suggestions: readonly string[],
): SearchOption[] {
  const text = query.trim();
  if (text === '') return [];
  const self = normalizeQuery(text);
  // key 在列表内唯一：联想异步到达时，已高亮的项不会跳走
  const siteOptions = searchEntries(text, sites, MAX_SITES).map(
    (site, index) => ({ kind: 'site', key: `site:${index}`, site }) as const,
  );
  const suggestOptions = [...new Set(suggestions)]
    .filter((suggestion) => normalizeQuery(suggestion) !== self)
    .slice(0, MAX_SUGGESTIONS)
    .map((suggestion) => ({ kind: 'suggest', key: `suggest:${suggestion}`, text: suggestion }) as const);
  return [...siteOptions, { kind: 'web', key: 'web', text }, ...suggestOptions];
}

/** 回车默认执行的一项：第一个网站是前缀级匹配时打开它，否则用搜索引擎搜索 */
export function defaultKey(options: readonly SearchOption[], query: string): string | undefined {
  const first = options[0];
  if (!first) return undefined;
  return first.kind === 'site' && isStrongMatch(query, first.site) ? first.key : 'web';
}

/** 用户用方向键 / 鼠标选过且仍在列表里时用它，否则回到默认项 */
export function resolveActive(
  options: readonly SearchOption[],
  chosen: string | undefined,
  query: string,
): string | undefined {
  return options.some((option) => option.key === chosen) ? chosen : defaultKey(options, query);
}

/** 上下键移动高亮，首尾循环 */
export function stepKey(options: readonly SearchOption[], current: string | undefined, delta: 1 | -1): string | undefined {
  if (options.length === 0) return undefined;
  const index = options.findIndex((option) => option.key === current);
  const start = delta === 1 ? -1 : options.length;
  const next = ((index === -1 ? start : index) + delta + options.length) % options.length;
  return options[next]!.key;
}

export function targetOf(option: SearchOption, engine: EngineId): string {
  return option.kind === 'site' ? option.site.url : searchUrl(engine, option.text);
}

/**
 * 联想异步到达时是否换成新列表：用户选中的联想词不在新列表里就先不换，
 * 否则高亮会悄悄跳回默认项，回车打开的不是用户选的那一项。下一次输入会重新请求。
 */
export function keepsChoice(next: readonly SearchOption[], chosen: string | undefined): boolean {
  return chosen === undefined || next.some((option) => option.key === chosen);
}

/** 由 key 生成元素 id：列表更新后同一项的 id 不变，aria-activedescendant 不会指到别的行 */
export function optionId(id: string, key: string): string {
  return `${id}-option-${encodeURIComponent(key)}`;
}

/** 读屏播报：有几个选项、回车会做什么（默认高亮不移动焦点，只能靠这句告知） */
export function announce(options: readonly SearchOption[], active: string | undefined, engine: EngineId): string {
  const option = options.find((candidate) => candidate.key === active);
  if (!option) return '';
  const action = option.kind === 'site' ? `打开 ${option.site.name}` : `用 ${ENGINES[engine].name} 搜索 ${option.text}`;
  return `${options.length} 个选项，回车${action}`;
}

/**
 * 从 { success, data } 响应里取出联想列表；格式不对时当作没有联想。
 * 残缺的 UTF-16 会让 optionId 里的 encodeURIComponent 抛错、整个面板渲染失败，逐条丢掉。
 * 这段在浏览器里运行，不用 String#isWellFormed（Safari 16.4 才有）；带 u 标志时 \p{Cs} 只匹配落单的代理项
 */
const LONE_SURROGATE = /\p{Cs}/u;

export function readSuggestions(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || !data.every((item): item is string => typeof item === 'string')) return [];
  return data.filter((text) => !LONE_SURROGATE.test(text));
}
