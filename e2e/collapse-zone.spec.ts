import type { Page } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

const toggle = (page: Page) => page.getByRole('button', { name: '扩展插件' });
const pluginHeadings = (page: Page) => [
  page.getByRole('heading', { name: '游戏动态' }),
  page.getByRole('heading', { name: '基金走势' }),
];

test.describe('折叠区（mobile: collapse）', () => {
  test('手机端：开关展开再收起', { tag: '@mobile' }, async ({ page }) => {
    await gotoHome(page);
    const button = toggle(page);
    const panelId = await button.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = page.locator(`[id="${panelId}"]`);

    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    for (const heading of pluginHeadings(page)) await expect(heading).toBeHidden();

    await button.tap();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    for (const heading of pluginHeadings(page)) await expect(heading).toBeVisible();

    await button.tap();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    for (const heading of pluginHeadings(page)) await expect(heading).toBeHidden();
  });

  test('桌面端：没有开关，内容直接显示', { tag: '@desktop' }, async ({ page }) => {
    await gotoHome(page);

    await expect(toggle(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '扩展插件' })).toBeVisible();
    for (const heading of pluginHeadings(page)) await expect(heading).toBeVisible();
  });
});
