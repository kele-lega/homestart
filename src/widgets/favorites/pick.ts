import type { Link } from '../../core/links';

/**
 * 常用网站显示哪几个：最近点开过的在前（最近的排第一），不够 count 个时先用 favorite: true 的补上，
 * 还不够再按导航里的顺序补（自己编辑的导航里通常没有 favorite 标记）。点击记录里已经不在链接里的网址直接跳过
 */
export function pickFavorites(links: readonly Link[], recent: readonly string[], count: number): readonly Link[] {
  const byUrl = new Map(links.map((link) => [link.url, link]));
  const visited = recent.flatMap((url) => byUrl.get(url) ?? []);
  const picked = [...new Set([...visited, ...links.filter((link) => link.favorite), ...links])];
  return picked.slice(0, count);
}
