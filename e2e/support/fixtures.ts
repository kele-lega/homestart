import { test as base, expect, type Page, type Route } from '@playwright/test';

/** 外部链接统一返回这个极小页面：测试从不连外网 */
export const STUB_TITLE = 'E2E 外部页面';
const STUB_HTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${STUB_TITLE}</title><p>stub</p></html>`;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** 搜索联想接口 GET /api/widgets/<id>/suggest?q= */
export function isSuggestUrl(url: URL): boolean {
  return /^\/api\/widgets\/[^/]+\/suggest$/.test(url.pathname);
}

/** 按接口约定的外层结构返回联想词 */
export function fulfillSuggest(route: Route, data: readonly string[]): Promise<void> {
  return route.fulfill({
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ success: true, data, error: null }),
  });
}

/**
 * 服务端岛屿（天气）的固定返回。不拦的话 e2e 服务端会去请求 Open-Meteo，
 * 而 Astro 在 <head> 里用 <link rel=preload> 预取岛屿，页面的 load 事件也会跟着等外网
 */
export const SERVER_ISLANDS = '**/_server-islands/**';
export const ISLAND_STUB_TEXT = 'E2E 天气';
const ISLAND_STUB_HTML = `<p data-e2e-island>${ISLAND_STUB_TEXT}</p>`;

export function fulfillIsland(route: Route): Promise<void> {
  return route.fulfill({ contentType: 'text/html; charset=utf-8', body: ISLAND_STUB_HTML });
}

export const test = base.extend({
  // 路由挂在 context 上，新标签页里的导航也会被拦截
  context: async ({ context }, use) => {
    await context.route(
      (url) => !LOCAL_HOSTS.has(url.hostname),
      (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: STUB_HTML }),
    );
    await use(context);
  },
  // 默认没有联想词、岛屿立即返回固定内容，e2e 服务端从不连外网；用例里后注册的 page.route 优先于这里
  page: async ({ page }, use) => {
    await page.route(isSuggestUrl, (route) => fulfillSuggest(route, []));
    await page.route(SERVER_ISLANDS, fulfillIsland);
    await use(page);
  },
});

export { expect };

/**
 * 打开首页，等 client:load 岛屿注水完成（注水后 astro-island 会去掉 ssr 属性）、
 * 服务端岛屿都换上固定内容（骨架屏里读屏用的「…加载中」全部消失）
 */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
  await expect(page.getByText('加载中')).toHaveCount(0);
  await expect(page.locator('[data-e2e-island]').first()).toBeAttached();
}
