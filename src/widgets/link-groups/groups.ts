import type { Link, LinksConfig } from '../../core/links';
import type { Tone } from '../../core/schema-parts';
import { hostOf } from '../../lib/url';

/** 传给浏览器端分类导航的一条链接，只保留显示需要的字段 */
export interface GroupLink {
  readonly name: string;
  readonly url: string;
  /** 名字下面的一行小字：有描述用描述，否则显示域名 */
  readonly meta: string;
  readonly icon?: string;
  readonly iconDark?: string;
}

export interface LinkGroup {
  readonly id: string;
  readonly name: string;
  readonly tone: Tone;
  readonly links: readonly GroupLink[];
}

function toGroupLink(link: Link): GroupLink {
  return {
    name: link.name,
    url: link.url,
    meta: link.description?.trim() || hostOf(link.url),
    ...(link.icon && { icon: link.icon }),
    ...(link.iconDark && { iconDark: link.iconDark }),
  };
}

/** 按 links.yaml 里 categories 的顺序分组；没有链接的分类不显示，没填分类的链接只参与搜索 */
export function groupLinks({ categories, links }: LinksConfig): LinkGroup[] {
  return categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      tone: category.tone,
      links: links.filter((link) => link.category === category.id).map(toGroupLink),
    }))
    .filter((group) => group.links.length > 0);
}
