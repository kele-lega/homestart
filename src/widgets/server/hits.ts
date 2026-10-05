import type { HitKind } from '../../lib/site-stats';

/**
 * 页面上哪些点击算数：带 data-visit 的链接（分类导航、常用网站的格子、搜索里选中的网站）是一次导航，
 * 搜索框打开的搜索引擎结果页（data-hit="search"）是一次搜索。左键和中键都算（中键在新标签页打开，触发的是 auxclick）
 */
export function hitOf(event: Pick<MouseEvent, 'button' | 'target'>): HitKind | undefined {
  if (event.button !== 0 && event.button !== 1) return undefined;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-visit], a[data-hit]') : null;
  if (!link) return undefined;
  if (link.dataset.hit === 'search') return 'search';
  return link.dataset.visit === undefined ? undefined : 'nav';
}
