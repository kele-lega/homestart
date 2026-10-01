import type { APIRequestContext, Page } from '@playwright/test';
import { E2E_ADMIN } from './support/accounts';
import { expect, gotoHome, test } from './support/fixtures';

// 登录入口是页顶的书签，登录页、个人中心是独立的页面。桌面和手机两个项目共用同一个服务端和内存库，
// 会改数据的用例各自新建一个账号，用户名带上项目名，互不干扰
const JSON_HEADERS = { 'content-type': 'application/json', 'x-home-client': '1' };
const PASSWORD = 'password-for-e2e';

/**
 * 用管理员身份建一个普通账号。会话 Cookie 带 Secure：浏览器把 127.0.0.1 当作安全来源照发，
 * Playwright 的请求上下文却不会在 http 上发，所以从 Set-Cookie 里取出来手动带上。
 * page.request 和页面共用 Cookie 存储：调用方随后 clearCookies，再以新账号登录
 */
async function createUser(request: APIRequestContext, username: string): Promise<void> {
  const login = await request.post('/api/auth/login', { headers: JSON_HEADERS, data: { ...E2E_ADMIN, remember: false } });
  expect(login.ok()).toBe(true);
  const token = /home_session=([^;]+)/.exec(login.headers()['set-cookie'] ?? '')?.[1];
  expect(token).toBeTruthy();
  const created = await request.post('/api/auth/users', {
    headers: { ...JSON_HEADERS, cookie: `home_session=${token}` },
    data: { username, password: PASSWORD, role: 'user' },
  });
  expect(created.ok(), await created.text()).toBe(true);
}

async function signIn(page: Page, username: string, password: string, { remember = false } = {}): Promise<void> {
  await page.goto('/login');
  // 注水之前提交按钮是灰的（原生提交经反代会被 checkOrigin 拦下，见 LoginForm.svelte）
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  if (remember) await page.getByLabel(/记住我/).check();
  await page.getByRole('button', { name: '登 录' }).click();
  await page.waitForURL('/');
}

test.describe('登录', () => {
  test('没登录时页顶挂着「登录」书签，点进登录页；登录页能回主页', async ({ page }) => {
    await gotoHome(page);
    const bookmark = page.getByRole('link', { name: '登录', exact: true });
    await expect(bookmark).toHaveAttribute('href', '/login');
    await bookmark.click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { name: '登录', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: '回主页' }).click();
    await expect(page).toHaveURL('/');
  });

  test('密码错了：红字提示，密码框清空、拿到焦点，还在登录页', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('用户名').fill(E2E_ADMIN.username);
    const password = page.getByLabel('密码', { exact: true });
    await password.fill('definitely-wrong');
    await page.getByRole('button', { name: '登 录' }).click();

    await expect(page.getByText('用户名或密码不对')).toBeVisible();
    await expect(password).toHaveValue('');
    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL('/login');
  });

  test('登录成功回到首页，书签换成名章、指向个人中心；再开登录页直接回首页', async ({ page }, testInfo) => {
    const username = `seal-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();

    await signIn(page, username, PASSWORD);
    const seal = page.getByRole('link', { name: `个人中心（${username}）` });
    await expect(seal).toHaveAttribute('href', '/account');
    await expect(seal).toHaveText(username[0]!.toUpperCase());

    await page.goto('/login');
    await expect(page).toHaveURL('/');
  });

  test('没登录打开个人中心会被送去登录页', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL('/login');
  });
});

test.describe('个人中心', () => {
  test('改昵称：书签上的名字跟着变', async ({ page }, testInfo) => {
    const username = `nick-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);

    await page.goto('/account');
    await page.getByRole('button', { name: '修改' }).click();
    const input = page.getByLabel('昵称');
    await expect(input).toBeFocused();
    await input.fill('小可乐');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('status').filter({ hasText: '昵称已保存' })).toBeVisible();
    await expect(page.getByRole('button', { name: '修改' })).toBeFocused();

    await gotoHome(page);
    await expect(page.getByRole('link', { name: '个人中心（小可乐）' })).toHaveText('小');
  });

  test('登录设备列出本机；在另一处登录后可以把它踢下线', async ({ page, browser }, testInfo) => {
    const username = `devices-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD, { remember: true });

    // 另一台「设备」：独立的浏览器上下文
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.route('**/_server-islands/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>x</p>' }));
    await signIn(otherPage, username, PASSWORD);

    await page.goto('/account');
    const devices = page.getByRole('region', { name: '登录设备' }).getByRole('listitem');
    await expect(devices).toHaveCount(2);
    await expect(devices.filter({ hasText: '本机' })).toContainText('记住 30 天');

    await page.getByRole('button', { name: '退出其它设备' }).click();
    await page.getByRole('button', { name: '全部退出' }).click();
    await expect(page.getByText('其它设备都已退出')).toBeVisible();
    await expect(devices).toHaveCount(1);

    // 被踢下线的那台再打开个人中心，得重新登录
    await otherPage.goto('/account');
    await expect(otherPage).toHaveURL('/login');
    await other.close();
  });

  test('改密码：当前密码错了不改；改好后旧密码登不上、新密码能登上', async ({ page }, testInfo) => {
    const username = `pw-${testInfo.project.name}`;
    const next = 'brand-new-password';
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);
    await page.goto('/account');
    const card = page.getByRole('region', { name: '修改密码' });

    await card.getByLabel('当前密码').fill('not-my-password');
    await card.getByLabel(/^新密码/).fill(next);
    await card.getByLabel('再输一遍新密码').fill(next);
    await card.getByRole('button', { name: '更新密码' }).click();
    await expect(card.getByRole('alert')).toContainText('当前密码');
    await expect(card.getByLabel('当前密码')).toBeFocused();

    await card.getByLabel('当前密码').fill(PASSWORD);
    await card.getByRole('button', { name: '更新密码' }).click();
    await expect(card.getByRole('status')).toHaveText('密码已更新');

    await page.context().clearCookies();
    const old = await page.request.post('/api/auth/login', { headers: JSON_HEADERS, data: { username, password: PASSWORD } });
    expect(old.status()).toBe(400);
    const fresh = await page.request.post('/api/auth/login', { headers: JSON_HEADERS, data: { username, password: next } });
    expect(fresh.ok()).toBe(true);
  });

  test('登出：回到首页、书签变回「登录」，个人中心打不开了', async ({ page }, testInfo) => {
    const username = `out-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);

    await page.goto('/account');
    await page.getByRole('button', { name: '登出' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: '登录', exact: true })).toHaveAttribute('href', '/login');
    await page.goto('/account');
    await expect(page).toHaveURL('/login');
  });

  test('只有管理员看得到账号管理', async ({ page }, testInfo) => {
    const username = `plain-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: '个人资料' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '账号管理' })).toHaveCount(0);

    await page.context().clearCookies();
    await signIn(page, E2E_ADMIN.username, E2E_ADMIN.password);
    await page.goto('/account');
    await expect(page.getByRole('region', { name: '账号管理' }).getByText(username, { exact: true })).toBeVisible();
  });
});
