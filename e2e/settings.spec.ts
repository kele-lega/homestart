import type { Page, Route, TestInfo } from '@playwright/test';
import { createUser, PASSWORD, signIn } from './support/accounts';
import { expect, gotoHome, test } from './support/fixtures';

// 设置页真的会存偏好（PREFERENCES_FILE 在 dist/e2e 下）：每个用例新建一个账号，用户名带上项目名和启动时刻，
// 两个项目、前后几轮 e2e 之间都互不干扰。Steam、日历、地名搜索要连外网的接口在用例里打桩
const RUN = Date.now().toString(36);

async function signInFresh(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const username = `${name}-${testInfo.project.name}-${RUN}`;
  await createUser(page.request, username);
  await page.context().clearCookies();
  await signIn(page, username, PASSWORD);
}

async function gotoSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
}

const card = (page: Page, title: string) => page.getByRole('region', { name: title });

test.describe('设置', () => {
  test('页头右边的齿轮进设置页；没登录只给一个登录入口', async ({ page }) => {
    await gotoHome(page);
    const gear = page.getByRole('link', { name: '设置', exact: true });
    await expect(gear).toHaveAttribute('href', '/settings');
    await gear.click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('link', { name: '设置', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('登录后才能修改')).toBeVisible();
    await expect(page.getByRole('link', { name: '登录', exact: true })).toHaveAttribute('href', '/login');
  });

  test('换搜索引擎：首页搜索用的就是它；恢复默认后回到配置里的第一个', async ({ page, context }, testInfo) => {
    await signInFresh(page, testInfo, 'engine');
    await gotoSettings(page);
    const search = card(page, '搜索');
    await expect(search.getByRole('radio', { name: 'Google' })).toBeChecked();
    await search.getByRole('radio', { name: 'DuckDuckGo' }).check();
    await search.getByRole('button', { name: '保存' }).click();
    await expect(search.getByRole('status')).toHaveText('已保存，回主页就能看到');
    await expect(search.getByText('已自定义')).toBeVisible();

    await gotoHome(page);
    const box = page.getByRole('combobox', { name: '搜索', exact: true });
    await expect(box).toHaveAttribute('placeholder', '搜索网站，或用 DuckDuckGo 搜索…');
    await box.fill('persist');
    const tab = context.waitForEvent('page');
    await box.press('Enter');
    await expect(await tab).toHaveURL('https://duckduckgo.com/?q=persist');

    await gotoSettings(page);
    await search.getByRole('button', { name: '恢复默认' }).click();
    await expect(search.getByRole('status')).toHaveText('已恢复默认设置');
    await expect(search.getByRole('radio', { name: 'Google' })).toBeChecked();
    await expect(search.getByText('默认', { exact: true })).toBeVisible();
  });

  test('天气地区：搜地名、点一个候选就换上，首页天气上方显示这个地名', async ({ page }, testInfo) => {
    const queries: string[] = [];
    await page.route(
      (url) => url.pathname === '/api/settings/places',
      (route: Route) => {
        queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
        const data = [
          { name: '坪山', region: '深圳 · 广东 · 中国', latitude: 22.69, longitude: 114.33 },
          { name: '坪山', region: '重庆市 · 中国', latitude: 30.1, longitude: 107.42 },
        ];
        return route.fulfill({ json: { success: true, data, error: null } });
      },
    );
    await signInFresh(page, testInfo, 'weather');
    await gotoSettings(page);
    const weather = card(page, '天气地区');
    await expect(weather.getByText('测试城')).toBeVisible();

    await weather.getByLabel(/换一个地方/).fill('坪山');
    await weather.getByRole('button', { name: '搜索' }).click();
    await weather.getByRole('button', { name: /坪山\s*深圳 · 广东 · 中国/ }).click();
    await expect(weather.getByRole('status')).toHaveText('已换成 坪山，回主页就能看到');
    await expect(weather.getByText('22.69, 114.33')).toBeVisible();
    expect(queries).toEqual(['坪山']);

    await gotoHome(page);
    await expect(page.locator('#w-weather .place')).toContainText('坪山');
  });

  test('写回 Google 日历：每个账号拿到自己的脚本，地址不对时说明原因', async ({ page }, testInfo) => {
    await signInFresh(page, testInfo, 'gsync');
    await gotoSettings(page);
    const sync = page.locator('#calendar-sync');
    await sync.getByRole('button', { name: '开始连接' }).click();
    const script = sync.getByRole('textbox', { name: 'Apps Script 脚本' });
    await expect(script).toHaveValue(/const SECRET = '[\w-]{32,}'/);
    const mine = await script.inputValue();

    await sync.getByLabel('网页应用网址').fill('https://example.com/not-a-script');
    await sync.getByRole('button', { name: '连接' }).click();
    await expect(sync.getByRole('status')).toContainText('script.google.com/macros/s/');

    // 刷新以后还是同一份脚本；换一个账号是另一份口令
    await page.reload();
    await expect(page.locator('#calendar-sync').getByRole('textbox', { name: 'Apps Script 脚本' })).toHaveValue(mine);
    await page.context().clearCookies();
    await signInFresh(page, testInfo, 'gsync2');
    await gotoSettings(page);
    await page.locator('#calendar-sync').getByRole('button', { name: '开始连接' }).click();
    await expect(page.locator('#calendar-sync').getByRole('textbox', { name: 'Apps Script 脚本' })).not.toHaveValue(mine);
  });

  test('日历订阅：地址不回显，Esc 收起；失败说明原因，成功后只显示主机名', async ({ page }, testInfo) => {
    const sent: unknown[] = [];
    let reply: object = { success: false, data: null, error: '日历地址无法访问' };
    await page.route(
      (url) => url.pathname === '/api/settings/calendar',
      async (route: Route) => {
        sent.push({ method: route.request().method(), body: route.request().postDataJSON() });
        await route.fulfill({ json: reply });
      },
    );
    await signInFresh(page, testInfo, 'ics');
    await gotoSettings(page);
    const calendar = card(page, '日历订阅');
    await expect(calendar.getByText('还没有订阅日历')).toBeVisible();

    const toggle = calendar.getByRole('button', { name: '添加订阅' });
    await toggle.click();
    const input = calendar.getByLabel('ICS 订阅地址');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(toggle).toBeFocused();

    await toggle.click();
    await input.fill('https://calendar.example.com/private/basic.ics');
    await calendar.getByRole('button', { name: '保存' }).click();
    await expect(calendar.getByRole('status')).toHaveText('日历地址无法访问');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    reply = { success: true, data: { configured: true, host: 'calendar.example.com' }, error: null };
    await calendar.getByRole('button', { name: '保存' }).click();
    await expect(calendar.getByText('订阅：calendar.example.com')).toBeVisible();
    await expect(input).toHaveCount(0);
    expect(sent).toEqual([
      { method: 'PUT', body: { url: 'https://calendar.example.com/private/basic.ics' } },
      { method: 'PUT', body: { url: 'https://calendar.example.com/private/basic.ics' } },
    ]);
  });

  test('Steam：绑定账号，改列几款；超出范围时说明原因', async ({ page }, testInfo) => {
    await page.route(
      (url) => url.pathname === '/api/settings/steam',
      (route: Route) => route.fulfill({ json: { success: true, data: { steamId: '76561197960265729' }, error: null } }),
    );
    await signInFresh(page, testInfo, 'steam');
    await gotoSettings(page);
    const steam = card(page, 'Steam');
    await steam.getByRole('button', { name: '绑定账号' }).click();
    await steam.getByLabel('SteamID64 或个人资料链接').fill('76561197960265729');
    await steam.getByRole('button', { name: '保存' }).first().click();
    await expect(steam.getByText('账号：76561197960265729')).toBeVisible();

    const count = steam.getByLabel(/最多列几款游戏/);
    await expect(count).toHaveValue('4');
    await count.fill('6');
    await steam.getByRole('button', { name: '保存' }).click();
    await expect(steam.getByText('已保存，回主页就能看到')).toBeVisible();
    await expect(steam.getByText('已自定义')).toBeVisible();
  });

  test('时钟：打开秒，首页的时间跟着带上秒；问候语没有了', async ({ page }, testInfo) => {
    await signInFresh(page, testInfo, 'clock');
    await gotoSettings(page);
    const clock = card(page, '时钟');
    await expect(clock.getByLabel(/称呼/)).toHaveCount(0);
    await clock.getByRole('checkbox', { name: '显示秒' }).check();
    await clock.getByRole('button', { name: '保存' }).click();
    await expect(clock.getByRole('status')).toHaveText('已保存，回主页就能看到');

    await gotoHome(page);
    await expect(page.locator('#w-clock [data-part="seconds"]')).toBeVisible();
    await expect(page.locator('#w-clock .greet')).toHaveCount(0);
  });

  test('时钟：时间旁可以只留农历', async ({ page }, testInfo) => {
    await signInFresh(page, testInfo, 'dateline');
    await gotoSettings(page);
    const clock = card(page, '时钟');
    await clock.getByRole('checkbox', { name: /^日期/ }).uncheck();
    await clock.getByRole('checkbox', { name: /^星期/ }).uncheck();
    await clock.getByRole('checkbox', { name: /^节日和节气/ }).uncheck();
    await clock.getByRole('button', { name: '保存' }).click();
    await expect(clock.getByRole('status')).toHaveText('已保存，回主页就能看到');

    await gotoHome(page);
    const line = page.locator('#w-clock .lunar');
    await expect(line).toBeVisible();
    await expect(page.locator('#w-clock .day')).toHaveCount(0);
    await expect(line).not.toContainText('·');
  });

  test('常用网站：点开过的网站排到最前，最多 4 个', async ({ page }, testInfo) => {
    // 外网一律不真的打开
    await page.context().route('https://www.douyin.com/**', (route) => route.fulfill({ body: 'ok' }));
    await signInFresh(page, testInfo, 'visits');
    await gotoHome(page);
    const tiles = page.locator('#w-favorites a.tile');
    await expect(tiles).toHaveCount(4);
    await expect(tiles.first()).toHaveAttribute('href', 'https://github.com/');

    const box = page.getByRole('combobox', { name: '搜索', exact: true });
    await box.fill('抖音');
    const recorded = page.waitForResponse((response) => response.url().endsWith('/api/links/visit'));
    const tab = page.context().waitForEvent('page');
    await page.getByRole('option', { name: /抖音/ }).first().click();
    await (await tab).close();
    // keepalive 请求的响应体 Playwright 读不到，只看状态码；记没记上看下面刷新后的顺序
    expect((await recorded).status()).toBe(200);

    await gotoHome(page);
    await expect(tiles).toHaveCount(4);
    await expect(tiles.first()).toHaveAttribute('href', 'https://www.douyin.com/');
    await expect(page.locator('#w-favorites .l-frame-sub')).toHaveText('最近点开');
  });

  test('导航：加一个分类和网站，首页分类导航和搜索都用它；恢复默认后回到站点的导航', async ({ page }, testInfo) => {
    // 抓图标要连外站：打桩成返回一个本站已有的图标
    await page.route('**/api/settings/site-icon', (route) =>
      route.fulfill({ json: { success: true, data: { icon: '/icons/github.svg' }, error: null } }),
    );
    await signInFresh(page, testInfo, 'links');
    await gotoSettings(page);
    const links = card(page, '导航');
    await expect(links.getByText('默认', { exact: true })).toBeVisible();
    await expect(links.getByRole('textbox', { name: '分类 1', exact: true })).toHaveValue('开发');

    await links.getByRole('button', { name: '＋ 添加分类' }).click();
    const name = links.getByRole('textbox', { name: /^分类 \d$/ }).last();
    await expect(name).toBeFocused();
    await name.fill('测试分类');
    await links.locator('fieldset').last().getByRole('button', { name: '＋ 添加网站' }).click();
    const url = links.getByRole('textbox', { name: /的网址$/ }).last();
    await url.fill('tool.example.com');
    await url.blur();
    // 失焦后补全成 https://，名称用域名，图标自动抓
    await expect(url).toHaveValue('https://tool.example.com');
    await expect(links.getByRole('textbox', { name: 'tool.example.com的名称' })).toHaveValue('tool.example.com');
    await expect(links.locator('fieldset').last().locator('img').first()).toHaveAttribute('src', '/icons/github.svg');
    await links.getByRole('textbox', { name: 'tool.example.com的名称' }).fill('测试工具');

    await links.getByRole('button', { name: '保存导航' }).click();
    await expect(links.getByRole('status').last()).toHaveText('已保存，回主页就能看到');
    await expect(links.getByText('已自定义')).toBeVisible();

    await gotoHome(page);
    const nav = page.getByRole('navigation', { name: '网站分类' });
    await expect(nav.getByRole('button', { name: /^测试分类/ })).toBeVisible();
    const box = page.getByRole('combobox', { name: '搜索', exact: true });
    await box.fill('测试工具');
    await expect(page.getByRole('option', { name: /测试工具/ }).first()).toBeVisible();

    page.on('dialog', (dialog) => void dialog.accept());
    await gotoSettings(page);
    await links.getByRole('button', { name: '恢复默认' }).click();
    await expect(links.getByRole('status').last()).toHaveText('已恢复默认导航');
    await gotoHome(page);
    await expect(nav.getByRole('button', { name: /^测试分类/ })).toHaveCount(0);
  });
});
