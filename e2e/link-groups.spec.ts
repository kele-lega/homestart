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
    await page.getByRole('heading', { name: '便签' }).click();
    await expect(dev).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });

  test('键盘：Tab 到分类按钮、回车展开、Tab 进面板里的链接', async ({ page }) => {
    const dev = chip(page, '开发');
    const panel = await panelOf(dev);
    const steamToggle = page.locator('#w-steam').getByRole('button', { name: '绑定账号' });

    // 从 Steam 的绑定开关出发（扩展插件区最后一个可 Tab 到的控件），下一个 Tab 就是第一个分类
    await steamToggle.focus();
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
