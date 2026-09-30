import type { Page } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

// 页面按服务端的「今天」渲染，过了站点时区的零点整页刷新一次。
// 用 Playwright 的假时钟模拟浏览器时钟不准、电脑睡过零点；每次都只看页面加载了几次
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// 刷新是在 setTimeout / 事件里触发的，出了问题几百毫秒内就会再加载一次
const SETTLE_MS = 1_500;

/** 从现在起页面触发 load 的次数（包括刷新） */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  return () => loads;
}

test.describe('过零点刷新', () => {
  test('浏览器时钟快了一天：按服务端的日期，不会一直刷新', async ({ page }) => {
    await page.clock.install({ time: Date.now() + DAY });
    const loads = countLoads(page);

    await gotoHome(page);
    await page.waitForTimeout(SETTLE_MS);

    expect(loads()).toBe(1);
  });

  test('睡过了零点：醒来刷新一次，之后不再刷新', async ({ page }) => {
    await page.clock.install({ time: Date.now() });
    await gotoHome(page);
    const loads = countLoads(page);

    const reloaded = page.waitForEvent('load');
    await page.clock.fastForward(DAY + MINUTE);
    await reloaded;
    await page.waitForTimeout(SETTLE_MS);

    expect(loads()).toBe(1);
  });
});
