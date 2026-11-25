import type { Page } from '@playwright/test';
import { createUser, E2E_ADMIN, PASSWORD, signIn } from './support/accounts';
import { expect, test } from './support/fixtures';

// 留白（新首页）：/、/cal、/dir、/play、/site 是同一份文档的五页，服务端按地址先显示其中一页，之后在页面里切换。
// 管理员的入口（账号管理、管理块、服务器状态）由服务端决定渲不渲染：别人的页面里连这些字都没有

/** 打开留白的某一页，等客户端岛屿都注水完 */
async function gotoInk(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
}

/** 管理员才有的东西：页面源码里出现任何一个都算泄露 */
const ADMIN_ONLY = ['/account#users', '账号管理', '管理员', '服 务 器', '/api/server/stats', 'InkAdmin'];

async function expectNoAdminTraces(page: Page): Promise<void> {
  const html = await page.content();
  for (const text of ADMIN_ONLY) expect(html, `页面里不该有「${text}」`).not.toContain(text);
}

test.describe('留白：权限', () => {
  test('访客：顶上是「登录」，五页里都没有管理入口，服务器接口也拒绝', async ({ page }) => {
    for (const path of ['/', '/cal', '/dir', '/play', '/site']) {
      await gotoInk(page, path);
      await expectNoAdminTraces(page);
    }
    await expect(page.getByRole('navigation', { name: '工具' }).getByRole('link', { name: '登录', exact: true })).toHaveAttribute(
      'href',
      '/login',
    );
    expect((await page.request.get('/api/server/stats')).status()).toBe(403);
  });

  test('普通用户：账号小纸有个人中心的入口，没有账号管理；跋页没有管理块', async ({ page }, testInfo) => {
    const username = `ink-user-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);

    await page.getByRole('button', { name: `账号（${username}）` }).click();
    const me = page.locator('#ink-me');
    await expect(me).toBeVisible();
    await expect(me.getByRole('link', { name: '个人资料' })).toHaveAttribute('href', '/account#profile');
    await expect(me.getByRole('link', { name: '登录设备' })).toHaveAttribute('href', '/account#sessions');
    await expect(me).toContainText('1 台');
    await expectNoAdminTraces(page);

    await gotoInk(page, '/site');
    await expect(page.getByRole('heading', { name: '留 言' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '管 理' })).toHaveCount(0);
    await expectNoAdminTraces(page);
    expect((await page.request.get('/api/server/stats')).status()).toBe(403);
  });

  test('管理员：多出账号管理和「管理员」印；跋页有管理块和服务器', async ({ page }) => {
    await signIn(page, E2E_ADMIN.username, E2E_ADMIN.password);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);

    await page.getByRole('button', { name: `账号（${E2E_ADMIN.username}）` }).click();
    const me = page.locator('#ink-me');
    await expect(me.getByText('管理员')).toBeVisible();
    await expect(me.getByRole('link', { name: '账号管理' })).toHaveAttribute('href', '/account#users');
    await page.keyboard.press('Escape');

    await gotoInk(page, '/site');
    await expect(page.getByRole('heading', { name: '管 理' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^查看建议/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '服 务 器' })).toBeVisible();
  });
});

test.describe('留白：页面', () => {
  test('入口进子页、地址跟着变；后退回首页；直接打开子页地址；Esc 回首页', async ({ page }) => {
    await gotoInk(page);
    const home = page.locator('.page.home');
    await page.locator('.ent[data-go="cal"]').click();
    await expect(page).toHaveURL('/cal');
    await expect(page.getByRole('heading', { name: '月令', level: 1 })).toBeVisible();
    await expect(home).toBeHidden();
    await expect(page).toHaveTitle(/^月令 · /);

    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(home).toBeVisible();

    await gotoInk(page, '/dir');
    await expect(page.getByRole('heading', { name: '目录', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^开发/, level: 2 })).toBeVisible();
    await page.locator('body').press('Escape');
    await expect(page).toHaveURL('/');
    await expect(home).toBeVisible();
  });

  test('滚轮：往下翻到后一页、往上回前一页；页面还能滚时先滚页面；到头不绕回去', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', '手机上没有滚轮');
    // 两次滚动之间停一停，才算两次手势
    const wheel = async (dy: number) => {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(400);
    };
    await gotoInk(page);
    await page.mouse.move(60, 450);
    await wheel(300);
    await expect(page).toHaveURL('/cal');
    await expect(page.locator('html')).not.toHaveClass(/vt-/);

    // 月令比一屏高：第一下滚到底，不翻
    const tall = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1);
    if (tall) {
      await wheel(3000);
      await expect(page).toHaveURL('/cal');
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    }
    await wheel(300);
    await expect(page).toHaveURL('/dir');
    await expect(page.locator('html')).not.toHaveClass(/vt-/);

    await wheel(-300);
    await expect(page).toHaveURL('/cal');
    await expect(page.locator('html')).not.toHaveClass(/vt-/);

    await gotoInk(page, '/site');
    await page.mouse.move(60, 450);
    await wheel(300);
    await expect(page).toHaveURL('/site');
  });

  test('子页：鼠标点空白处回首页，点到字不回', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', '手机上点空白不回首页');
    await gotoInk(page, '/site');
    await page.locator('.keys-tip').click();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL('/site');

    await page.locator('.page[data-page="site"]').click({ position: { x: 20, y: 380 } });
    await expect(page).toHaveURL('/');
    await expect(page.locator('.page.home')).toBeVisible();
  });

  test('分类：点一个换一组网站，刷新后还记得', async ({ page }) => {
    await gotoInk(page);
    const work = page.getByRole('tab', { name: /^办公/ });
    await work.click();
    await expect(work).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveCount(1);
    await expect(panel.getByRole('link', { name: /Gmail/ })).toBeVisible();

    await gotoInk(page);
    await expect(page.getByRole('tab', { name: /^办公/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('问：打字就出站内网站，最近访问和分类让位', async ({ page }) => {
    await gotoInk(page);
    await page.locator('#ink-q').fill('git');
    await expect(page.getByRole('option', { name: /GitHub/ })).toBeVisible();
    await expect(page.locator('.below')).toBeHidden();
    await page.locator('#ink-q').fill('');
    await expect(page.locator('.below')).toBeVisible();
  });

  test('外部网站和搜索都在新标签页打开，首页留在原处', async ({ page, context }) => {
    await context.route(
      (url) => url.hostname !== '127.0.0.1',
      (route) => route.fulfill({ body: '' }),
    );
    const opensNewTab = async (open: () => Promise<void>, url: RegExp) => {
      const popup = context.waitForEvent('page');
      await open();
      const tab = await popup;
      await expect(tab).toHaveURL(url);
      await tab.close();
      await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(dir)?$/);
    };

    await gotoInk(page);
    await opensNewTab(() => page.locator('.fav').first().click(), /^https:\/\//);
    await opensNewTab(() => page.getByRole('tabpanel').getByRole('link').first().click(), /^https:\/\//);
    await page.locator('#ink-q').fill('新标签页');
    await opensNewTab(() => page.locator('#ink-q').press('Enter'), /^https:\/\/www\.google\.com\/search\?q=/);
    await expect(page.locator('.page.home')).toBeVisible();

    await gotoInk(page, '/dir');
    await opensNewTab(() => page.locator('.dcol a[data-visit]').first().click(), /^https:\/\//);
  });

  test('问：搜过的词记在这台设备上，点进空的输入框就列出来；选中按 Delete 删掉', async ({ page, context }) => {
    // 搜索引擎的页面不真的打开
    await context.route(
      (url) => url.hostname !== '127.0.0.1',
      (route) => route.fulfill({ body: '' }),
    );
    await gotoInk(page);
    const box = page.locator('#ink-q');
    await box.fill('homestart 记录');
    const popup = context.waitForEvent('page');
    await box.press('Enter');
    await (await popup).close();
    await expect(box).toHaveValue('');

    await box.blur();
    await box.click();
    const saved = page.getByRole('option', { name: 'homestart 记录' });
    await expect(saved).toBeVisible();
    await expect(page.locator('.below')).toBeHidden();

    // 打字时对得上的旧记录排在联想前面
    await box.fill('homestart');
    await expect(saved).toBeVisible();

    await box.fill('');
    await box.press('ArrowDown');
    await expect(saved).toHaveAttribute('aria-selected', 'true');
    await box.press('Delete');
    await expect(saved).toHaveCount(0);
    await expect(page.getByRole('listbox')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('home:search-history'))).toBeNull();
  });

  test('月令：访客看到登录提示；登录后添一笔就记在选中的那天', async ({ page }, testInfo) => {
    await gotoInk(page, '/cal');
    await expect(page.getByText('后可以在这里添日程')).toBeVisible();

    const username = `ink-cal-${testInfo.project.name}-${Date.now().toString(36)}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);
    await gotoInk(page, '/cal');
    await page.getByLabel('在这一天添一笔').fill('交房租');
    await page.getByRole('button', { name: '记下' }).click();
    await expect(page.getByRole('button', { name: '修改 交房租' })).toBeVisible();
  });
});

test.describe('留白：附属页面', () => {
  test('登录页是留白的样子，左上角「归 首页」回到留白首页', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'ink');
    await page.getByRole('link', { name: '首页', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.page.home')).toBeVisible();
  });
});
