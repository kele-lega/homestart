import type { Link, LinksConfig } from '../../core/links';
import type { Tone } from '../../core/schema-parts';

/** 传给浏览器端分类导航的一条链接，只保留显示需要的字段：面板里只显示图标和名字 */
export interface GroupLink {
  readonly name: string;
  readonly url: string;
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
