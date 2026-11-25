/**
 * 留白的五个页面：首页和四个子页（月令、目录、游艺、跋）。五个地址由服务端渲染成同一份文档，
 * 站内切换用 history.pushState，不重新加载（见 ./router.ts）。服务端和浏览器共用，不能引用服务端模块
 */

export const SUB_PAGES = ['cal', 'dir', 'play', 'site'] as const;
export type SubPage = (typeof SUB_PAGES)[number];
export type InkRoute = 'home' | SubPage;

export interface PageMeta {
  /** 页眉的大字 */
  readonly name: string;
  /** 印章里的一个字 */
  readonly seal: string;
  /** 页眉下面的一行小字 */
  readonly sub: string;
}

export const PAGES: Readonly<Record<SubPage, PageMeta>> = {
  cal: { name: '月令', seal: '历', sub: '日程与期限' },
  dir: { name: '目录', seal: '录', sub: '全部网站' },
  play: { name: '游艺', seal: '玩', sub: '最近两周' },
  site: { name: '跋', seal: '站', sub: '本站与建议' },
};

export function isSubPage(value: unknown): value is SubPage {
  return typeof value === 'string' && (SUB_PAGES as readonly string[]).includes(value);
}

export function pathOf(route: InkRoute): string {
  return route === 'home' ? '/' : `/${route}`;
}

/** 地址 → 页面；不是这五个地址时 undefined（例如 /settings，交给浏览器整页跳转） */
export function routeOf(pathname: string): InkRoute | undefined {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'home';
  const name = path.slice(1);
  return isSubPage(name) ? name : undefined;
}

/** 子页之间前后翻：首尾相接 */
export function neighbor(page: SubPage, delta: 1 | -1): SubPage {
  const index = SUB_PAGES.indexOf(page);
  return SUB_PAGES[(index + delta + SUB_PAGES.length) % SUB_PAGES.length]!;
}

/** 从 from 翻到 to 算不算往后翻（卷轴从右往左展开）；走的是较近的那个方向 */
export function isForward(from: SubPage, to: SubPage): boolean {
  const n = SUB_PAGES.length;
  return (SUB_PAGES.indexOf(to) - SUB_PAGES.indexOf(from) + n) % n <= n / 2;
}

export function titleOf(route: InkRoute, siteTitle: string): string {
  return route === 'home' ? siteTitle : `${PAGES[route].name} · ${siteTitle}`;
}
