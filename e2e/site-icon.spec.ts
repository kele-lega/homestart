import type { Page } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

// 图标整体 aria-hidden，没有可访问名称，只能用组件自己的类名和 data-variant
const ICON = '.site-icon';
const LETTER = '.site-icon .letter';

const githubTile = (page: Page) => page.getByRole('link', { name: 'GitHub', exact: true });

test.describe('网站图标', () => {
  test('图标 404 时搜索结果里退回首字母', async ({ page }) => {
    await gotoHome(page);
    await page.getByRole('combobox', { name: '搜索', exact: true }).fill('断链');
    const row = page.getByRole('option', { name: /^断链工具/ });
    await expect(row).toBeVisible();

    await expect(row.locator(LETTER)).toHaveText('断');
    await expect(row.locator(`${ICON} img`)).toHaveCount(0);
  });

  test('图标 404 时分类卡片上的图标摞也退回首字母', async ({ page }) => {
    await gotoHome(page);
    const nav = page.getByRole('navigation', { name: '网站分类' });
    // 懒加载图片要进入视口附近才会请求，滚过去才会失败
    await nav.scrollIntoViewIfNeeded();
    const stack = nav.getByRole('button', { name: /^开发/ }).locator(ICON);

    // 开发分类的前三个链接：GitHub、云主机、断链工具
    await expect(stack).toHaveCount(3);
    await expect(stack.nth(2).locator('.letter')).toHaveText('断');
    await expect(stack.nth(2).locator('img')).toHaveCount(0);
    await expect(stack.nth(0).locator('.letter')).toHaveCount(0);
  });

  test('深色主题换用 iconDark', async ({ page }) => {
    await gotoHome(page);
    const tile = githubTile(page);
    const light = tile.locator('img[data-variant="light"]');
    const dark = tile.locator('img[data-variant="dark"]');
    await expect(light).toHaveAttribute('src', '/icons/github.svg');
    await expect(dark).toHaveAttribute('src', '/icons/github-light.svg');

    await expect(light).toBeVisible();
    await expect(dark).toBeHidden();

    await page.getByRole('radio', { name: '深色' }).click();
    await expect(dark).toBeVisible();
    await expect(light).toBeHidden();

    // 跟随系统 + 系统深色也一样
    await page.getByRole('radio', { name: '跟随系统' }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(dark).toBeVisible();
    await expect(light).toBeHidden();
  });
});
