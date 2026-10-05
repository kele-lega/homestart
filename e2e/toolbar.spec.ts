import { createUser, E2E_ADMIN, PASSWORD, signIn } from './support/accounts';
import { expect, gotoHome, test } from './support/fixtures';

// 页头右边的三个圆。公告文件写在 dist/e2e 下，两个项目、前后几轮都可能留下别的公告：
// 每个用例自己发的标题带上项目名和启动时刻，只认自己那几条，不假设列表是空的
const RUN = Date.now().toString(36);

test.describe('页头工具栏', () => {
  test('三个圆：头像、设置、公告；设置直接进设置页', async ({ page }) => {
    await gotoHome(page);
    const toolbar = page.locator('#w-toolbar');
    await expect(toolbar.getByRole('link', { name: '登录', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('link', { name: '设置', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^公告/ })).toBeVisible();
    // 原来页顶的书签和主题切换旁的齿轮都没有了，入口只剩这一处
    await expect(page.locator('.bookmark')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '设置', exact: true })).toHaveCount(1);

    await toolbar.getByRole('link', { name: '设置', exact: true }).click();
    await expect(page).toHaveURL('/settings');
  });

  test('悬停在头像上展开账号面板，移开收起；分栏链到个人中心各块', { tag: '@desktop' }, async ({ page }, testInfo) => {
    const username = `panel-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);

    const avatar = page.getByRole('link', { name: `个人中心（${username}）` });
    const sessions = page.getByRole('link', { name: '登录设备' });
    await expect(sessions).toBeHidden();
    await avatar.hover();
    await expect(sessions).toBeVisible();
    await expect(page.getByRole('link', { name: '个人资料' })).toHaveAttribute('href', '/account#profile');
    await expect(page.getByRole('link', { name: '修改密码' })).toHaveAttribute('href', '/account#password');
    await expect(page.getByRole('link', { name: '账号管理' })).toHaveCount(0);
    await expect(page.locator('#w-toolbar .stats')).toContainText('1 台');

    // 从头像挪到面板里，面板不收
    await sessions.hover();
    await expect(sessions).toBeVisible();
    await page.mouse.move(10, 600);
    await expect(sessions).toBeHidden();

    await avatar.hover();
    await sessions.click();
    await expect(page).toHaveURL('/account#sessions');
    await expect(page.getByRole('region', { name: '登录设备' })).toBeInViewport();
  });

  test('头像和面板同步开合：一扫而过不展开，半路折回也不各走各的', { tag: '@desktop' }, async ({ page }) => {
    // 整轮默认「减少动态效果」，过渡和等待都被 base.css 压成 0；这条要看的就是过渡本身
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await gotoHome(page);
    const avatar = page.getByRole('link', { name: '登录', exact: true });
    const box = await avatar.boundingBox();
    if (!box) throw new Error('头像没有尺寸');
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(10, 600);

    // 接下来 900ms 里每一帧都记下头像的放大和面板的透明度
    const sampling = page.evaluate(
      () =>
        new Promise<{ scale: number; opacity: number; visible: boolean }[]>((resolve) => {
          const account = document.querySelector<HTMLElement>('[data-account]')!;
          const avatarEl = account.querySelector<HTMLElement>('.avatar')!;
          const panel = account.querySelector<HTMLElement>('.panel')!;
          const samples: { scale: number; opacity: number; visible: boolean }[] = [];
          const start = performance.now();
          const tick = () => {
            const scale = Number(getComputedStyle(avatarEl).scale);
            const style = getComputedStyle(panel);
            samples.push({
              scale: Number.isNaN(scale) ? 1 : scale,
              opacity: Number(style.opacity),
              visible: style.visibility === 'visible',
            });
            if (performance.now() - start < 900) requestAnimationFrame(tick);
            else resolve(samples);
          };
          requestAnimationFrame(tick);
        }),
    );

    // 一扫而过：停留不到展开前的那点等待
    await page.mouse.move(center.x, center.y);
    await page.mouse.move(10, 600);
    await page.waitForTimeout(150);
    // 再正经悬停，展开到一半移开、又马上移回来
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(200);
    await page.mouse.move(10, 600);
    await page.waitForTimeout(60);
    await page.mouse.move(center.x, center.y);

    const samples = await sampling;
    // 头像放大多少和面板淡入多少始终是同一个量：scale = 1 + 0.9 × opacity
    for (const s of samples) expect(Math.abs(s.scale - 1 - 0.9 * s.opacity)).toBeLessThan(0.02);
    // 一扫而过的那段（前 150ms 左右）面板一直没出来
    expect(samples.slice(0, 6).every((s) => !s.visible && s.opacity === 0)).toBe(true);
    // 最后是展开的
    await expect(page.getByRole('link', { name: '去登录' })).toBeVisible();
  });

  test('键盘：Tab 到头像上展开，Esc 收起', { tag: '@desktop' }, async ({ page }) => {
    await gotoHome(page);
    const avatar = page.getByRole('link', { name: '登录', exact: true });
    const login = page.getByRole('link', { name: '去登录' });
    await avatar.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(login).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(login).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(login).toBeHidden();
    await expect(avatar).toBeFocused();
  });

  test('面板里退出登录：回到首页，头像变回「登录」', { tag: '@desktop' }, async ({ page }, testInfo) => {
    const username = `bye-${testInfo.project.name}`;
    await createUser(page.request, username);
    await page.context().clearCookies();
    await signIn(page, username, PASSWORD);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);

    await page.getByRole('link', { name: `个人中心（${username}）` }).hover();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('link', { name: '登录', exact: true })).toHaveAttribute('href', '/login');
    await page.goto('/account');
    await expect(page).toHaveURL('/login');
  });

  test('公告：弹出窗口，点虚化的地方关上；Esc 也能关，焦点回到按钮上', async ({ page }) => {
    await gotoHome(page);
    const trigger = page.getByRole('button', { name: /^公告/ });
    const dialog = page.getByRole('dialog', { name: '公告' });

    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
    // 点在纸上不关
    await dialog.getByRole('heading', { name: '公告' }).click();
    await expect(dialog).toBeVisible();
    // 左上角是纸外面的虚化处
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
    await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');

    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toBeHidden();
  });

  test('公告：管理员发布、删除；别人看到小红点，打开就算看过', async ({ page }, testInfo) => {
    const title = `e2e 公告 ${testInfo.project.name} ${RUN}`;
    await signIn(page, E2E_ADMIN.username, E2E_ADMIN.password);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    const trigger = page.getByRole('button', { name: /^公告/ });
    const dialog = page.getByRole('dialog', { name: '公告' });

    await trigger.click();
    await dialog.getByRole('button', { name: '写一条' }).click();
    await dialog.getByLabel('标题').fill(title);
    await dialog.getByLabel(/^正文/).fill('第一行\n第二行');
    await dialog.getByRole('button', { name: '发布' }).click();
    await expect(dialog.getByRole('status')).toHaveText('已发布');
    const item = dialog.getByRole('listitem').filter({ hasText: title });
    await expect(item).toContainText('第一行\n第二行');
    await expect(item).toContainText(E2E_ADMIN.username);

    // 换成没登录的访客，这个浏览器也没看过：小红点亮着，打开后就灭了
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await gotoHome(page);
    await expect(page.getByRole('button', { name: '公告（有新的）' })).toBeVisible();
    await trigger.click();
    await expect(dialog.getByRole('listitem').filter({ hasText: title })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '写一条' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '删除' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '公告', exact: true })).toBeVisible();
    await gotoHome(page);
    await expect(page.getByRole('button', { name: '公告', exact: true })).toBeVisible();

    // 普通用户直接调接口也发不了
    const denied = await page.request.post('/api/announcements', {
      headers: { 'content-type': 'application/json', 'x-home-client': '1' },
      data: { title: 'x', body: '' },
    });
    expect(denied.status()).toBe(403);

    await signIn(page, E2E_ADMIN.username, E2E_ADMIN.password);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    await trigger.click();
    const mine = dialog.getByRole('listitem').filter({ hasText: title });
    await mine.getByRole('button', { name: '删除' }).click();
    await mine.getByRole('button', { name: '确认删除' }).click();
    await expect(dialog.getByRole('status')).toHaveText(`已删除「${title}」`);
    await expect(mine).toHaveCount(0);
  });
});
