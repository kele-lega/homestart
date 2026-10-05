import type { Page } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

const THEME_KEY = 'home:theme';

const themeGroup = (page: Page) => page.getByRole('radiogroup', { name: '配色主题' });
const themeOption = (page: Page, name: '跟随系统' | '浅色' | '深色') => themeGroup(page).getByRole('radio', { name });
const html = (page: Page) => page.locator('html');
const storedTheme = (page: Page) => page.evaluate((key) => localStorage.getItem(key), THEME_KEY);

test.describe('配色主题', () => {
  test('三个选项切换 <html data-theme>', async ({ page }) => {
    await gotoHome(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'system');
    await expect(themeOption(page, '跟随系统')).toBeChecked();

    await themeOption(page, '深色').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(themeOption(page, '深色')).toBeChecked();
    await expect(themeOption(page, '跟随系统')).not.toBeChecked();
    await expect(html(page)).toHaveCSS('color-scheme', 'dark');

    await themeOption(page, '浅色').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(themeOption(page, '浅色')).toBeChecked();
    await expect(html(page)).toHaveCSS('color-scheme', 'light');

    await themeOption(page, '跟随系统').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'system');
    // 跟随系统不占存储
    expect(await storedTheme(page)).toBeNull();
  });

  test('刷新后保留选择，且在岛屿注水前就已生效（无闪烁）', async ({ page }) => {
    // <body> 刚插入时记下 data-theme：此时只有 <head> 里的内联脚本跑过
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        if (!document.body) return;
        observer.disconnect();
        Object.assign(window, { __themeAtBody: document.documentElement.dataset.theme ?? null });
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await gotoHome(page);
    await themeOption(page, '深色').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    expect(await storedTheme(page)).toBe('dark');

    await page.reload({ waitUntil: 'domcontentloaded' });
    const early = await page.evaluate(() => ({
      atBody: (window as unknown as { __themeAtBody: string | null }).__themeAtBody,
      theme: document.documentElement.dataset.theme,
    }));
    expect(early.atBody).toBe('dark');
    expect(early.theme).toBe('dark');

    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(themeOption(page, '深色')).toBeChecked();
  });

  test('跟随系统时随 prefers-color-scheme 变化，固定浅色时不跟随', async ({ page }) => {
    await gotoHome(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'system');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveCSS('color-scheme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html(page)).toHaveCSS('color-scheme', 'light');

    await themeOption(page, '浅色').click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveCSS('color-scheme', 'light');
  });
});
