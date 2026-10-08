import type { Locator, Page } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

// 与 LinkGroups.svelte 里的 OPEN_DELAY / CLOSE_DELAY 一致
const OPEN_DELAY = 120;
const CLOSE_DELAY = 180;

const nav = (page: Page) => page.getByRole('navigation', { name: '网站分类' });
const chip = (page: Page, name: string) => nav(page).getByRole('button', { name: new RegExp(`^${name}`) });
// data-open / data-pinned 挂在分类的 li 上，没有可访问名称可用
const group = (page: Page, id: string) => nav(page).locator(`[data-group="${id}"]`);

/** 面板没有 role，按按钮的 aria-controls 找到它 */
async function panelOf(button: Locator): Promise<Locator> {
  const id = await button.getAttribute('aria-controls');
  if (!id) throw new Error('分类按钮缺少 aria-controls');
  return button.page().locator(`[id="${id}"]`);
}

test.describe('分类导航（桌面）', { tag: '@desktop' }, () => {
  // 悬停的延迟用假时钟推进，不靠真实等待
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await gotoHome(page);
    await page.clock.pauseAt(Date.now() + 1000);
  });

  test('悬停预览，移进面板保持展开，离开后收起', async ({ page }) => {
    const dev = chip(page, '开发');
    const panel = await panelOf(dev);

    await dev.hover();
    await page.clock.runFor(OPEN_DELAY - 20);
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await page.clock.runFor(20);
    await expect(dev).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    // 悬停只是预览，不是固定
    await expect(group(page, 'dev')).not.toHaveAttribute('data-pinned');

    await panel.getByRole('link', { name: /^GitHub/ }).hover();
    await page.clock.runFor(CLOSE_DELAY * 2);
    await expect(panel).toBeVisible();

    await page.mouse.move(5, 5);
    await page.clock.runFor(CLOSE_DELAY - 20);
    await expect(panel).toBeVisible();
    await page.clock.runFor(20);
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });

  test('点击固定，鼠标离开也不收起；再点一次取消', async ({ page }) => {
    const dev = chip(page, '开发');
    const panel = await panelOf(dev);

    await dev.click();
    await expect(dev).toHaveAttribute('aria-expanded', 'true');
    await expect(group(page, 'dev')).toHaveAttribute('data-pinned');

    await page.mouse.move(5, 5);
    await page.clock.runFor(CLOSE_DELAY * 3);
    await expect(panel).toBeVisible();
    await expect(group(page, 'dev')).toHaveAttribute('data-pinned');

    await dev.click();
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(group(page, 'dev')).not.toHaveAttribute('data-pinned');
    await expect(panel).toBeHidden();
  });

  test('Esc 与点击别处都会收起', async ({ page }) => {
    const dev = chip(page, '开发');
    const panel = await panelOf(dev);

    await dev.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await expect(dev).toBeFocused();

    await dev.click();
    await expect(panel).toBeVisible();
    // 页头的时间在签子上方，面板向下弹出，不会挡住它
    await page.locator('#w-clock .time').click();
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });

  test('点开面板里的网站后收起', async ({ page, context }) => {
    const dev = chip(page, '开发');
    const panel = await panelOf(dev);

    await dev.click();
    await expect(panel).toBeVisible();
    const tab = context.waitForEvent('page');
    await panel.getByRole('link', { name: /^GitHub/ }).click();
    await tab;
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });

  // 签子变窄时图标多的那几张不能把「N 个网站」挤成多行，否则同一排高矮不一
  test('同一排签子等高，与网站数量无关', async ({ page }) => {
    // 夹具里每组都是三个网站：拿掉一组图标摞里的一个，当作只有两个网站的分类
    await group(page, 'fun').locator('.stack > *').last().evaluate((node) => node.remove());
    // 夹具只有三组，签子很宽；把导航收窄到每张签子 160～200px（真实页面六组、窗口 1000～1300px 时的宽度）
    for (const width of [640, 560, 520]) {
      await nav(page).evaluate((node, value) => (node.style.inlineSize = `${value}px`), width);
      const heights = await nav(page)
        .locator('.chip')
        .evaluateAll((chips) => chips.map((node) => node.getBoundingClientRect().height));
      expect(new Set(heights).size, `导航宽 ${width}px：${heights.join(' / ')}`).toBe(1);
    }
  });

  test('面板向下弹出，不挡住上面页头里的搜索框', async ({ page }) => {
    const dev = chip(page, '开发');
    const panel = await panelOf(dev);

    await dev.click();
    await expect(panel).toBeVisible();
    const [chipBox, panelBox, headerBox] = await Promise.all([
      dev.boundingBox(),
      panel.boundingBox(),
      page.locator('#z-header').boundingBox(),
    ]);
    expect(panelBox!.y).toBeGreaterThanOrEqual(chipBox!.y + chipBox!.height);
    expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
  });

  test('键盘：Tab 到分类按钮、回车展开、Tab 进面板里的链接', async ({ page }) => {
    const dev = chip(page, '开发');
    const panel = await panelOf(dev);
    // 从分类导航的外框出发（前面页头里的控件随登录状态变化），下一个 Tab 就是第一个分类
    await page.locator('#w-categories').evaluate((node: HTMLElement) => {
      node.tabIndex = -1;
      node.focus();
    });
    await page.keyboard.press('Tab');
    await expect(dev).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dev).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();

    const links = panel.getByRole('link');
    await expect(links).toHaveCount(3);
    for (const name of ['GitHub', '云主机', '断链工具']) {
      await page.keyboard.press('Tab');
      await expect(panel.getByRole('link', { name: new RegExp(`^${name}`) })).toBeFocused();
    }

    // Tab 离开这一组时收起
    await page.keyboard.press('Tab');
    await expect(chip(page, '办公')).toBeFocused();
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });
});

test.describe('分类导航（手机）', { tag: '@mobile' }, () => {
  test('点按展开、再点收起，各组互不影响', async ({ page }) => {
    await gotoHome(page);
    const dev = chip(page, '开发');
    const work = chip(page, '办公');
    const devPanel = await panelOf(dev);

    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(devPanel).toBeHidden();

    await dev.tap();
    await expect(dev).toHaveAttribute('aria-expanded', 'true');
    await expect(devPanel.getByRole('link', { name: /^GitHub/ })).toBeVisible();

    await work.tap();
    await expect(work).toHaveAttribute('aria-expanded', 'true');
    await expect(dev).toHaveAttribute('aria-expanded', 'true');

    await dev.tap();
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(devPanel).toBeHidden();
    await expect(work).toHaveAttribute('aria-expanded', 'true');
  });
});
