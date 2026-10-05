import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** e2e 服务端启动时建的管理员（内存库，每次启动都是新的），playwright.config.ts 和登录用例共用 */
export const E2E_ADMIN = { username: 'e2e-admin', password: 'e2e-password-1' } as const;

export const JSON_HEADERS = { 'content-type': 'application/json', 'x-home-client': '1' };
export const PASSWORD = 'password-for-e2e';
/** e2e 服务端的建议验证码答案固定是这个（SUGGESTION_CAPTCHA_FIXED） */
export const E2E_CAPTCHA = '2468';

/**
 * 用管理员身份建一个普通账号。会话 Cookie 带 Secure：浏览器把 127.0.0.1 当作安全来源照发，
 * Playwright 的请求上下文却不会在 http 上发，所以从 Set-Cookie 里取出来手动带上。
 * page.request 和页面共用 Cookie 存储：调用方随后 clearCookies，再以新账号登录
 */
export async function createUser(request: APIRequestContext, username: string): Promise<void> {
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

export async function signIn(page: Page, username: string, password: string, { remember = false } = {}): Promise<void> {
  await page.goto('/login');
  // 注水之前提交按钮是灰的（原生提交经反代会被 checkOrigin 拦下，见 LoginForm.svelte）
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  if (remember) await page.getByLabel(/记住我/).check();
  await page.getByRole('button', { name: '登 录' }).click();
  await page.waitForURL('/');
}
