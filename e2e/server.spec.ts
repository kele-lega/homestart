import type { Locator, Page } from '@playwright/test';
import { createUser, E2E_ADMIN, E2E_CAPTCHA, JSON_HEADERS, PASSWORD, signIn } from './support/accounts';
import { expect, gotoHome, test } from './support/fixtures';

// 圆环读的是 e2e 服务端所在机器的真实读数，只断言形状，不断言数值；计数整轮共用一个文件，只断言「加了一」
const TOTAL = '导航与搜索';
const panel = (page: Page) => page.locator('#w-server');
const RUN = Date.now().toString(36);

/** 「本站」在 e2e 布局里放在手机端可折叠的「扩展插件」区域，手机端要先展开开关 */
async function gotoPanel(page: Page): Promise<void> {
  await gotoHome(page);
  const toggle = page.getByRole('button', { name: '扩展插件' });
  if (await toggle.count()) await toggle.tap();
}

async function adminOnPanel(page: Page): Promise<void> {
  await signIn(page, E2E_ADMIN.username, E2E_ADMIN.password);
  await gotoPanel(page);
}

/** 读屏文字「导航与搜索 12 次」里的数 */
async function countOf(scope: Locator, label: string): Promise<number> {
  const text = await scope.getByText(new RegExp(`^${label} \\d+ 次$`)).textContent();
  return Number(text?.match(/\d+/)?.[0]);
}

async function toServer(page: Page): Promise<void> {
  await panel(page).getByRole('button', { name: '翻到服务器' }).click();
  await expect(panel(page).getByRole('heading', { name: '服务器' })).toBeVisible();
}

test.describe('本站', () => {
  test('所有人都看得到计数；没登录时提示登录后提建议，看不到服务器', async ({ page }) => {
    await gotoPanel(page);
    await expect(panel(page).getByRole('heading', { name: '本站' })).toBeVisible();
    await expect(panel(page).getByText(/^导航与搜索 \d+ 次$/)).toBeAttached();
    await expect(panel(page).getByRole('link', { name: '登录后提交建议' })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: '翻到服务器' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'terminal' })).toHaveCount(0);

    const response = await page.request.get('/api/server/stats', { headers: JSON_HEADERS });
    expect(response.status()).toBe(403);
  });

  test('点开分类导航里的网站加一，搜索一次再加一', async ({ page }) => {
    await gotoPanel(page);
    const start = await countOf(panel(page), TOTAL);

    const link = page.locator('#w-categories a[data-visit]').first();
    // 手机端分类导航先要展开分类，直接派发点击，只关心计数
    const tab = page.context().waitForEvent('page');
    await link.dispatchEvent('click', { button: 0 });
    await (await tab).close();
    await expect(panel(page).getByText(`${TOTAL} ${start + 1} 次`)).toBeAttached();

    const box = page.getByRole('combobox', { name: '搜索', exact: true });
    await box.fill(`e2e-${RUN}`);
    const searchTab = page.context().waitForEvent('page');
    await box.press('Enter');
    await (await searchTab).close();
    await expect(panel(page).getByText(`${TOTAL} ${start + 2} 次`)).toBeAttached();

    // 刷新后服务端的数也是这个
    await gotoPanel(page);
    expect(await countOf(panel(page), TOTAL)).toBeGreaterThanOrEqual(start + 2);
  });

  test('别的页面点一下，开着的页面不刷新就跟着加一', async ({ page, context }) => {
    await gotoPanel(page);
    const start = await countOf(panel(page), TOTAL);

    // 另一个标签页（别的访客也一样）记一次：经实时推送到这一页
    const other = await context.newPage();
    const response = await other.request.post('/api/site/stats', { headers: JSON_HEADERS, data: { kind: 'search' } });
    expect(response.status()).toBe(200);
    await other.close();

    await expect(panel(page).getByText(`${TOTAL} ${start + 1} 次`)).toBeAttached({ timeout: 3000 });
  });

  test('登录用户提建议，管理员在「查看建议」里看到、标为已处理、删除', async ({ page }, testInfo) => {
    const username = `sg-${testInfo.project.name}-${RUN}`;
    const body = `e2e 建议 ${testInfo.project.name} ${RUN}`;
    await createUser(page.request, username);
    await page.context().clearCookies();

    await signIn(page, username, PASSWORD);
    await gotoPanel(page);
    await expect(panel(page).getByRole('button', { name: /^查看建议/ })).toHaveCount(0);
    const box = panel(page).getByRole('textbox', { name: '你的建议' });
    await box.fill(body);
    // 点进表单才领题；答案在 e2e 服务端固定成 E2E_CAPTCHA
    await expect(panel(page).getByRole('img', { name: /^验证码图片/ })).toBeVisible();
    const code = panel(page).getByRole('textbox', { name: '验证码' });
    await code.fill('0000');
    await panel(page).getByRole('button', { name: '提交' }).click();
    await expect(panel(page).getByText('验证码不对，请看新的图重新填写')).toBeVisible();
    await expect(code).toHaveValue('');
    await expect(box).toHaveValue(body);

    await code.fill(E2E_CAPTCHA);
    await panel(page).getByRole('button', { name: '提交' }).click();
    await expect(panel(page).getByText('收到了，谢谢你的建议')).toBeVisible();
    await expect(box).toHaveValue('');

    await page.context().clearCookies();
    await adminOnPanel(page);
    await panel(page).getByRole('button', { name: /^查看建议/ }).click();
    const dialog = page.getByRole('dialog', { name: '建议' });
    await expect(dialog).toBeVisible();
    const item = dialog.getByRole('listitem').filter({ hasText: body });
    await expect(item).toContainText(username);

    await item.getByRole('button', { name: '标为已处理' }).click();
    await expect(item.getByText('已处理', { exact: true })).toBeVisible();
    await item.getByRole('button', { name: '删除' }).click();
    await item.getByRole('button', { name: '确认删除' }).click();
    await expect(dialog.getByRole('listitem').filter({ hasText: body })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('非管理员不能看建议列表', async ({ page }) => {
    const response = await page.request.get('/api/suggestions', { headers: JSON_HEADERS });
    expect(response.status()).toBe(403);
  });

  test('管理员的「发布公告」直接打开公告弹窗的写一条', async ({ page }) => {
    await adminOnPanel(page);
    await panel(page).getByRole('button', { name: '发布公告' }).click();
    const dialog = page.getByRole('dialog', { name: '公告' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: '标题' })).toBeFocused();
  });
});

test.describe('服务器', () => {
  test('管理员翻到服务器看到三个圆环、运行时长和入口，再翻回本站', async ({ page }) => {
    await adminOnPanel(page);
    await expect(panel(page).getByRole('link', { name: 'terminal' })).toBeHidden();
    await toServer(page);
    for (const label of ['CPU', '内存', '存储']) {
      await expect(panel(page).getByRole('button', { name: new RegExp(`^${label}\\s*\\d+%$`) })).toBeVisible();
    }
    await expect(panel(page).getByText(/^已运行/)).toBeVisible();
    await expect(panel(page).getByRole('link', { name: 'terminal' })).toBeVisible();

    await panel(page).getByRole('button', { name: '翻回本站' }).click();
    await expect(panel(page).getByRole('heading', { name: '本站' })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'CPU' })).toBeHidden();
  });

  test('悬停弹出详细读数，Esc 收起', { tag: '@desktop' }, async ({ page }) => {
    await adminOnPanel(page);
    await toServer(page);
    const tip = panel(page).getByRole('tooltip').filter({ hasText: '负载' });
    await expect(tip).toBeHidden();

    await panel(page).getByRole('button', { name: /^CPU/ }).hover();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/\d+ 核/);

    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
  });

  test('入口悬停显示说明和域名', { tag: '@desktop' }, async ({ page }) => {
    await adminOnPanel(page);
    await toServer(page);
    const tip = panel(page).getByRole('tooltip').filter({ hasText: 'work.example.com' });

    await panel(page).getByRole('link', { name: 'terminal' }).hover();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('网页终端');
  });

  test('触屏点按圆环打开说明，点别处收起', { tag: '@mobile' }, async ({ page }) => {
    await adminOnPanel(page);
    await toServer(page);
    const tip = panel(page).getByRole('tooltip').filter({ hasText: '可用' });

    await panel(page).getByRole('button', { name: /^内存/ }).tap();
    await expect(tip).toBeVisible();

    await panel(page).getByRole('heading', { name: '服务器' }).tap();
    await expect(tip).toBeHidden();
  });
});
