import type { Page } from '@playwright/test';
import { expect, fulfillSuggest, gotoHome, isSuggestUrl, STUB_TITLE, test } from './support/fixtures';

const searchBox = (page: Page) => page.getByRole('combobox', { name: '搜索', exact: true });
const results = (page: Page) => page.getByRole('listbox', { name: '搜索结果' });
const siteGroup = (page: Page) => results(page).getByRole('group', { name: '网站' });

/**
 * 记录已被页面读完的联想响应：包一层 Response.json，读完后再隔一个宏任务才记下，
 * 此时页面对这次响应的处理（含 Svelte 的微任务刷新）都已结束
 */
async function trackSuggestions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const settled: string[] = [];
    Object.assign(window, { __suggestSettled: settled });
    const json = Response.prototype.json;
    Response.prototype.json = function (this: Response) {
      const result: Promise<unknown> = json.call(this);
      const url = this.url ? new URL(this.url) : undefined;
      if (url?.pathname.endsWith('/suggest')) {
        const query = url.searchParams.get('q') ?? '';
        void result.then(() => setTimeout(() => settled.push(query), 0));
      }
      return result;
    };
  });
}

async function waitForSuggestions(page: Page, query: string): Promise<void> {
  await expect
    .poll(() => page.evaluate((q) => (window as unknown as { __suggestSettled: string[] }).__suggestSettled.includes(q), query))
    .toBe(true);
}

test.describe('搜索', () => {
  test('按名称筛选网站', async ({ page }) => {
    await gotoHome(page);
    await searchBox(page).fill('git');

    await expect(results(page)).toBeVisible();
    await expect(siteGroup(page).getByRole('option')).toHaveCount(1);
    await expect(siteGroup(page).getByRole('option', { name: /^GitHub/ })).toBeVisible();
    await expect(results(page).getByRole('option', { name: '“git”' })).toBeVisible();
  });

  test('按关键词筛选网站（名称和域名里都没有这个词）', async ({ page }) => {
    await gotoHome(page);
    await searchBox(page).fill('translate');

    await expect(siteGroup(page).getByRole('option')).toHaveCount(1);
    await expect(siteGroup(page).getByRole('option', { name: /^百度翻译/ })).toBeVisible();
  });

  test('回车打开高亮的网站', async ({ page, context }) => {
    await gotoHome(page);
    await searchBox(page).fill('git');
    const row = siteGroup(page).getByRole('option', { name: /^GitHub/ });
    await expect(row).toHaveAttribute('aria-selected', 'true');

    const tab = context.waitForEvent('page');
    await searchBox(page).press('Enter');
    const opened = await tab;

    await expect(opened).toHaveURL('https://github.com/');
    await expect(opened).toHaveTitle(STUB_TITLE);
    await expect(searchBox(page)).toHaveValue('');
  });

  test('回车用配置里的第一个搜索引擎搜索输入的文字；首页上没有换引擎的下拉框', async ({ page, context }) => {
    await gotoHome(page);
    await expect(page.getByRole('combobox', { name: '搜索引擎' })).toHaveCount(0);
    await expect(searchBox(page)).toHaveAttribute('placeholder', '搜索网站，或用 Google 搜索…');
    await searchBox(page).fill('hello world');
    await expect(results(page).getByRole('group', { name: '用 Google 搜索' })).toBeVisible();
    await expect(results(page).getByRole('option', { name: '“hello world”' })).toHaveAttribute('aria-selected', 'true');

    const tab = context.waitForEvent('page');
    await searchBox(page).press('Enter');
    await expect(await tab).toHaveURL('https://www.google.com/search?q=hello+world');
  });

  test('点搜索引擎签直接搜输入的文字，即使高亮的是网站；没输入时只聚焦搜索框', async ({ page, context }) => {
    await gotoHome(page);
    const engine = page.getByRole('button', { name: '用 Google 搜索' });

    await engine.click();
    await expect(searchBox(page)).toBeFocused();

    await searchBox(page).fill('git');
    await expect(siteGroup(page).getByRole('option', { name: /^GitHub/ })).toHaveAttribute('aria-selected', 'true');
    const tab = context.waitForEvent('page');
    await engine.click();
    await expect(await tab).toHaveURL('https://www.google.com/search?q=git');
    await expect(searchBox(page)).toHaveValue('');
  });

  test('不在输入时按 / 聚焦搜索框', { tag: '@desktop' }, async ({ page }) => {
    await gotoHome(page);
    await expect(searchBox(page)).not.toBeFocused();

    await page.keyboard.press('/');
    await expect(searchBox(page)).toBeFocused();
    // 快捷键被消费，不会把 / 写进输入框
    await expect(searchBox(page)).toHaveValue('');

    // 已经在输入框里时 / 是普通字符
    await page.keyboard.type('a/b');
    await expect(searchBox(page)).toHaveValue('a/b');

    // 焦点在其它输入控件上时不抢焦点：首页上没有别的输入框了，临时放一个
    await page.evaluate(() => document.body.append(Object.assign(document.createElement('input'), { id: 'e2e-other' })));
    const other = page.locator('#e2e-other');
    await other.focus();
    await page.keyboard.press('/');
    await expect(other).toBeFocused();
  });

  test('Esc 每次只退一步：收起面板 → 清空 → 失焦', { tag: '@desktop' }, async ({ page }) => {
    await gotoHome(page);
    const box = searchBox(page);
    await box.fill('git');
    await expect(results(page)).toBeVisible();

    await box.press('Escape');
    await expect(results(page)).toBeHidden();
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(box).toHaveValue('git');
    await expect(box).toBeFocused();

    await box.press('Escape');
    await expect(box).toHaveValue('');
    await expect(box).toBeFocused();
    await expect(page.getByRole('button', { name: '清空' })).toHaveCount(0);

    await box.press('Escape');
    await expect(box).not.toBeFocused();
  });

  test('方向键选中的联想词不在新结果里时保留旧列表', { tag: '@desktop' }, async ({ page }) => {
    await trackSuggestions(page);
    const ab = await mockStaleSuggestions(page);
    await gotoHome(page);
    const box = searchBox(page);
    const apple = results(page).getByRole('option', { name: 'apple', exact: true });

    await box.fill('a');
    await expect(apple).toBeVisible();
    await box.press('b');
    await box.press('ArrowDown');
    // 方向键落在 "ab" 的联想返回之前：此时列表里还是 "a" 的联想
    expect(ab.served()).toBe(false);
    await expect(apple).toHaveAttribute('aria-selected', 'true');

    await waitForSuggestions(page, 'ab');
    await expect(apple).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute('aria-activedescendant', (await apple.getAttribute('id')) ?? 'missing-id');
    await expect(results(page).getByRole('option', { name: 'abc news' })).toHaveCount(0);

    const tab = page.context().waitForEvent('page');
    await box.press('Enter');
    await expect(await tab).toHaveURL('https://www.google.com/search?q=apple');
  });

  test('鼠标悬停不算选定：新联想到达后换成新列表', { tag: '@desktop' }, async ({ page }) => {
    const ab = await mockStaleSuggestions(page);
    await gotoHome(page);
    const box = searchBox(page);
    const apple = results(page).getByRole('option', { name: 'apple', exact: true });

    await box.fill('a');
    await expect(apple).toBeVisible();
    await box.press('b');
    await apple.hover();
    expect(ab.served()).toBe(false);
    await expect(apple).toHaveAttribute('aria-selected', 'true');

    await expect(results(page).getByRole('option', { name: 'abc news' })).toBeVisible();
    await expect(apple).toHaveCount(0);
  });
});

/** "a" 立即返回 apple / amazon；"ab" 延迟约 800ms 才返回，且不含 apple */
async function mockStaleSuggestions(page: Page): Promise<{ served: () => boolean }> {
  let abServed = false;
  await page.route(isSuggestUrl, async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query !== 'ab') return fulfillSuggest(route, query === 'a' ? ['apple', 'amazon'] : []);
    await new Promise((resolve) => setTimeout(resolve, 800));
    abServed = true;
    return fulfillSuggest(route, ['abc news', 'abandon']);
  });
  return { served: () => abServed };
}
