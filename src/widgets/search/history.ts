import { normalizeQuery } from '../../lib/fuzzy';

/**
 * 搜索记录：最近搜过的十条，只存在这台设备的浏览器里（localStorage），不上传。
 * 只记往搜索引擎搜的词（自己打的、选的联想词、点的旧记录），打开收录的网站不算——那些进「最近访问」。
 * 这里是纯逻辑，读写 localStorage 在用它的组件里
 */

export const HISTORY_KEY = 'home:search-history';
export const MAX_HISTORY = 10;
/** 输入时跟着显示的、和输入对得上的旧记录最多几条 */
export const MAX_HISTORY_MATCHES = 3;
const MAX_LENGTH = 200;
/** 落单的 UTF-16 代理项：拼进元素 id 时 encodeURIComponent 会抛错 */
const LONE_SURROGATE = /\p{Cs}/u;

function usable(text: unknown): text is string {
  return typeof text === 'string' && text.trim() !== '' && text.length <= MAX_LENGTH && !LONE_SURROGATE.test(text);
}

/** 读存下的记录；格式不对的整体当作没有，单条不合格的丢掉 */
export function parseHistory(raw: string | null): string[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data
    .filter(usable)
    .map((text) => text.trim())
    .filter((text) => {
      const key = normalizeQuery(text);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_HISTORY);
}

/** 搜了一次：放到最前面，同一个词（大小写、全半角不同也算）只留一条，超过十条挤掉最旧的 */
export function remember(history: readonly string[], text: string): string[] {
  const entry = text.trim();
  if (!usable(entry)) return [...history];
  const key = normalizeQuery(entry);
  return [entry, ...history.filter((old) => normalizeQuery(old) !== key)].slice(0, MAX_HISTORY);
}

export function forget(history: readonly string[], text: string): string[] {
  return history.filter((old) => old !== text);
}

/** 输入时显示的旧记录：包含输入内容、又不就是输入内容本身的，新的在前 */
export function matchHistory(history: readonly string[], query: string, limit = MAX_HISTORY_MATCHES): string[] {
  const needle = normalizeQuery(query);
  if (needle === '') return [];
  return history
    .filter((text) => {
      const key = normalizeQuery(text);
      return key !== needle && key.includes(needle);
    })
    .slice(0, limit);
}
