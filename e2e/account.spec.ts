import { createUser, E2E_ADMIN, JSON_HEADERS, PASSWORD, signIn } from './support/accounts';
import { expect, gotoHome, test } from './support/fixtures';

// 1×1 的红点：浏览器真能解码，上传前会被裁剪、缩放、转码
const RED_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// 登录入口是页头右边的头像圆，登录页、个人中心是独立的页面。桌面和手机两个项目共用同一个服务端和内存库，
// 会改数据的用例各自新建一个账号，用户名带上项目名，互不干扰

test.describe('登录', () => {
  test('没登录时页头的头像是「登录」，点进登录页；登录页能回主页', async ({ page }) => {
    await gotoHome(page);
    const avatar = page.getByRole('link', { name: '登录', exact: true });
    await expect(avatar).toHaveAttribute('href', '/login');
    await avatar.click();
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

  test('登录成功回到首页，头像换成默认色块图、指向个人中心；再开登录页直接回首页', async ({ page }, testInfo) => {
    const username = `seal-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();

    await signIn(page, username, PASSWORD);
    const avatar = page.getByRole('link', { name: `个人中心（${username}）` });
    await expect(avatar).toHaveAttribute('href', '/account');
    // 新账号没传过头像，显示默认色块图
    await expect(avatar.locator('svg')).toBeVisible();

    await page.goto('/login');
    await expect(page).toHaveURL('/');
  });

  test('没登录打开个人中心会被送去登录页', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL('/login');
  });
});

test.describe('个人中心', () => {
  test('改昵称：页头头像的名字跟着变', async ({ page }, testInfo) => {
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
    await expect(page.getByRole('link', { name: '个人中心（小可乐）' })).toBeVisible();
  });

  test('上传头像：个人中心和首页都换成这张图；恢复默认后换回色块图、旧图片删掉', async ({ page }, testInfo) => {
    const username = `face-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);

    await page.goto('/account');
    const preview = page.locator('.avatar-preview');
    await expect(preview.locator('svg')).toBeVisible();
    await expect(page.getByRole('button', { name: '恢复默认' })).toHaveCount(0);

    await page.getByLabel('上传头像').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(RED_PIXEL_PNG, 'base64') });
    await expect(page.getByRole('status').filter({ hasText: '头像已更新' })).toBeVisible();
    const image = preview.locator('img');
    await expect(image).toHaveAttribute('src', /^\/avatars\/[0-9a-f]{32}\.(webp|png)$/);
    const src = (await image.getAttribute('src'))!;
    const served = await page.request.get(src);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toMatch(/^image\/(webp|png)$/);

    await gotoHome(page);
    await expect(page.getByRole('link', { name: `个人中心（${username}）` }).locator('img')).toHaveAttribute('src', src);

    await page.goto('/account');
    await page.getByRole('button', { name: '恢复默认' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已换回默认头像' })).toBeVisible();
    await expect(preview.locator('svg')).toBeVisible();
    expect((await page.request.get(src)).status()).toBe(404);
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

  test('登出：回到首页、头像变回「登录」，个人中心打不开了', async ({ page }, testInfo) => {
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
