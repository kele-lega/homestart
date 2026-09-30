import type { Page, Route } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

// e2e 用户是匿名的、没有订阅：month 操作走真实的 e2e 服务端（格子、农历、节假日都是真的），日程在用例里注入。
// 用例不依赖今天是几号：月份都从页面上读出来再推算
const MONTH_ACTION = '/api/widgets/calendar/month';
const SUBSCRIBE_ACTION = '/api/widgets/calendar/subscribe';

const calendar = (page: Page) => page.locator('#w-calendar');
const grid = (page: Page) => calendar(page).getByRole('group', { name: /^\d+年\d+月$/ });
const cells = (page: Page) => grid(page).locator('[data-date]');
const monthLabel = async (page: Page) => (await grid(page).getAttribute('aria-label')) ?? '';

/** 打开首页，等日历挂载后取回本月数据（底部换成订阅入口） */
async function gotoCalendar(page: Page): Promise<void> {
  await gotoHome(page);
  await expect(calendar(page).getByText('还没有订阅日历')).toBeVisible();
}

/** 「2026年9月」往后推 delta 个月：同样格式的标题和 'YYYY-MM' */
function shiftLabel(label: string, delta: number): { readonly label: string; readonly key: string } {
  const [, year, month] = /^(\d+)年(\d+)月$/.exec(label) ?? [];
  const index = Number(year) * 12 + Number(month) - 1 + delta;
  const [y, m] = [Math.floor(index / 12), (index % 12) + 1];
  return { label: `${y}年${m}月`, key: `${y}-${String(m).padStart(2, '0')}` };
}

interface Entry {
  readonly id: string;
  readonly title: string;
  readonly time: string;
  readonly location?: string;
}
const entry = (title: string, time: string, location?: string): Entry => ({ id: title, title, time, location });

/** 给每次取回的月份的 15 号放上几件日程，其余照真实响应；返回最近一次放日程的日子 */
async function injectEntries(page: Page, entries: readonly Entry[]): Promise<() => string> {
  let day = '';
  await page.route(
    (url) => url.pathname === MONTH_ACTION,
    async (route: Route) => {
      const response = await route.fetch();
      const body = await response.json();
      day = `${body.data.grid.key}-15`;
      body.data.feed = { status: 'ok', stale: false, data: { [day]: entries } };
      await route.fulfill({ response, json: body });
    },
  );
  return () => day;
}

test.describe('日历', () => {
  test('翻页后标题跟着换，「回到本月」回来', async ({ page }) => {
    await gotoCalendar(page);
    const now = await monthLabel(page);
    const back = calendar(page).getByRole('button', { name: '回到本月' });
    await expect(back).toHaveCount(0);

    await calendar(page).getByRole('button', { name: '下个月' }).click();
    await expect(grid(page)).toHaveAttribute('aria-label', shiftLabel(now, 1).label);
    await calendar(page).getByRole('button', { name: '下个月' }).click();
    await expect(grid(page)).toHaveAttribute('aria-label', shiftLabel(now, 2).label);

    await back.click();
    await expect(grid(page)).toHaveAttribute('aria-label', now);
    await expect(back).toHaveCount(0);
    await expect(grid(page).locator('[tabindex="0"]')).toHaveCount(1);
    // 按钮点完就没了，焦点交给今天那一格，不掉到页面开头
    await expect(grid(page).getByRole('button', { name: /，今天/ })).toBeFocused();
  });

  test('点一天列出当天的日程，再点一次收起', async ({ page }) => {
    const dayOf = await injectEntries(page, [entry('中秋', '全天'), entry('组会', '14:00', '三楼')]);
    await gotoCalendar(page);
    const cell = grid(page).locator(`[data-date="${dayOf()}"]`);
    const list = calendar(page).getByRole('list');
    await expect(cell).toHaveAccessibleName(/，2 件日程$/);

    await cell.click();
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    await expect(calendar(page).getByText(/^\d+月15日 星期.，农历/)).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').nth(1)).toContainText('14:00');
    await expect(list.getByRole('listitem').nth(1)).toContainText('三楼');

    await cell.click();
    await expect(cell).toHaveAttribute('aria-pressed', 'false');
    await expect(list).toHaveCount(0);
  });

  test('方向键在格子间移动，PageDown 翻到下个月的 1 号', { tag: '@desktop' }, async ({ page }) => {
    await gotoCalendar(page);
    const next = shiftLabel(await monthLabel(page), 1);
    const nth = (index: number) => cells(page).nth(index);

    // 第三周的周二：上下左右都还有格子
    await nth(15).focus();
    for (const [key, index] of [['ArrowRight', 16], ['ArrowDown', 23], ['Home', 21], ['End', 27], ['ArrowUp', 20]] as const) {
      await page.keyboard.press(key);
      await expect(nth(index), key).toBeFocused();
    }
    await expect(grid(page).locator('[tabindex="0"]')).toHaveCount(1);
    await expect(nth(20)).toHaveAttribute('tabindex', '0');

    await page.keyboard.press('PageDown');
    await expect(grid(page)).toHaveAttribute('aria-label', next.label);
    await expect(page.locator(':focus')).toHaveAttribute('data-date', `${next.key}-01`);
  });

  test('按住 PageDown 不放，系统连发的按键不翻页', { tag: '@desktop' }, async ({ page }) => {
    await gotoCalendar(page);
    const next = shiftLabel(await monthLabel(page), 1);
    const cell = cells(page).nth(15);
    await cell.focus();

    // 按住不放时浏览器连发的 keydown 都带 repeat
    await cell.dispatchEvent('keydown', { key: 'PageDown', repeat: true, bubbles: true });
    await page.keyboard.press('PageDown');

    await expect(page.locator(':focus')).toHaveAttribute('data-date', `${next.key}-01`);
    await expect(grid(page)).toHaveAttribute('aria-label', next.label);
  });

  test('订阅读取失败时底部提示，重试会重新去取', async ({ page }) => {
    let failing = true;
    await page.route(
      (url) => url.pathname === MONTH_ACTION,
      async (route: Route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (failing) body.data.feed = { status: 'error', message: '连接超时' };
        await route.fulfill({ response, json: body });
      },
    );
    await gotoCalendar(page);
    const notice = calendar(page).getByText('日历读取失败：连接超时');
    await expect(notice).toBeVisible();

    failing = false;
    await calendar(page).getByRole('button', { name: '重试' }).click();
    await expect(notice).toHaveCount(0);
  });

  test('翻页取不到时底部提示，可以重试', async ({ page }) => {
    let requests = 0;
    let failing = true;
    // 第一次是挂载时取本月，放行；之后翻页的请求先让它失败
    await page.route(
      (url) => url.pathname === MONTH_ACTION,
      (route: Route) => (++requests > 1 && failing ? route.abort() : route.continue()),
    );
    await gotoCalendar(page);
    const now = await monthLabel(page);
    const next = shiftLabel(now, 1);

    await calendar(page).getByRole('button', { name: '下个月' }).click();
    await expect(calendar(page).getByText(`${next.label}的日程没有取到`)).toBeVisible();
    await expect(grid(page)).toHaveAttribute('aria-label', now);

    failing = false;
    await calendar(page).getByRole('button', { name: '重试' }).click();
    await expect(grid(page)).toHaveAttribute('aria-label', next.label);
    await expect(calendar(page).getByText('没有取到')).toHaveCount(0);
  });

  test('订阅表单：地址不回显，Esc 收起并把焦点还给开关', async ({ page }) => {
    await gotoCalendar(page);
    const toggle = calendar(page).getByRole('button', { name: '添加订阅' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    const input = calendar(page).getByLabel('ICS 订阅地址');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');

    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // 焦点在表单里的按钮上时按 Esc 也收起
    await toggle.click();
    await calendar(page).getByRole('button', { name: '保存' }).focus();
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test('保存订阅：失败时说明原因、表单留着；成功后整页刷新', async ({ page }) => {
    const sent: unknown[] = [];
    let reply: object = { success: false, data: null, error: '日历地址无法访问' };
    await page.route(
      (url) => url.pathname === SUBSCRIBE_ACTION,
      async (route: Route) => {
        sent.push({ method: route.request().method(), body: route.request().postDataJSON() });
        await route.fulfill({ json: reply });
      },
    );
    await gotoCalendar(page);
    await calendar(page).getByRole('button', { name: '添加订阅' }).click();
    const input = calendar(page).getByLabel('ICS 订阅地址');
    const save = calendar(page).getByRole('button', { name: '保存' });
    await input.fill('https://calendar.example.com/private/basic.ics');

    await save.click();
    await expect(calendar(page).getByRole('status')).toHaveText('日历地址无法访问');
    await expect(input).toBeVisible();
    // 保存期间按钮是禁用的：失败后焦点回到输入框，读屏念出原因
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(/日历地址无法访问/);
    expect(sent).toEqual([{ method: 'PUT', body: { url: 'https://calendar.example.com/private/basic.ics' } }]);

    reply = { success: true, data: { configured: true, host: 'calendar.example.com' }, error: null };
    await Promise.all([page.waitForEvent('framenavigated'), save.click()]);
    expect(sent).toHaveLength(2);
  });
});
