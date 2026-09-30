import type { Link } from '../../core/links';
import type { SearchEntry } from '../../lib/fuzzy';
import { hostOf } from '../../lib/url';

/** 传给浏览器端搜索框的网站信息，只保留搜索和显示需要的字段 */
export interface SiteEntry extends SearchEntry {
  readonly icon?: string;
  readonly iconDark?: string;
}

export function toSiteEntry(link: Link): SiteEntry {
  return {
    name: link.name,
    url: link.url,
    host: hostOf(link.url),
    keywords: link.keywords,
    favorite: link.favorite,
    ...(link.icon && { icon: link.icon }),
    ...(link.iconDark && { iconDark: link.iconDark }),
  };
}
