import type { Route } from '@playwright/test';
import { expect, fulfillIsland, ISLAND_STUB_TEXT, SERVER_ISLANDS, test } from './support/fixtures';

// E2E 从不连 Open-Meteo：服务端岛屿换成固定内容（见 support/fixtures）。
// 这里只验证骨架屏与岛屿替换的衔接，真实天气数据的渲染由单元测试覆盖
test.describe('天气', () => {
  test('地名立即显示，骨架屏随后被替换', async ({ page }) => {
    const weather = page.locator('#w-weather');
    // 先扣住岛屿请求，证明地名和骨架屏不依赖它
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let intercepted = false;
    await page.route(SERVER_ISLANDS, async (route: Route) => {
      intercepted = true;
      await held;
      await fulfillIsland(route);
    });

    try {
      // 被扣住的是 <link rel=preload> 预取的地址，load 事件会一直等它，所以只等到收到文档
      await page.goto('/', { waitUntil: 'commit' });
      await expect.poll(() => intercepted).toBe(true);
      await expect(weather.getByText('测试城')).toBeVisible();
      await expect(weather.getByText('天气加载中')).toHaveCount(1);
    } finally {
      release();
    }

    await expect(weather.getByText(ISLAND_STUB_TEXT)).toBeVisible();
    await expect(weather.getByText('天气加载中')).toHaveCount(0);
    await expect(weather.getByText('测试城')).toBeVisible();
  });
});
