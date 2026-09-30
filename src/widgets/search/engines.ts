/**
 * 外部搜索引擎。地址固定写死，配置里只能选 id，layout.yaml 写错也不会把关键词发到别的站点。
 * 这个文件会被打进浏览器端（Search.svelte），不要放服务端内容。
 */

export const ENGINE_IDS = ['google', 'bing', 'duckduckgo', 'brave'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export interface Engine {
  readonly name: string;
  /** 搜索结果页地址，同时是无 JS 时表单的 action */
  readonly action: string;
  /** 关键词参数名 */
  readonly param: string;
}

export const ENGINES: Readonly<Record<EngineId, Engine>> = {
  google: { name: 'Google', action: 'https://www.google.com/search', param: 'q' },
  bing: { name: 'Bing', action: 'https://www.bing.com/search', param: 'q' },
  duckduckgo: { name: 'DuckDuckGo', action: 'https://duckduckgo.com/', param: 'q' },
  brave: { name: 'Brave', action: 'https://search.brave.com/search', param: 'q' },
};

export function searchUrl(engine: EngineId, query: string): string {
  const { action, param } = ENGINES[engine];
  return `${action}?${new URLSearchParams({ [param]: query })}`;
}
