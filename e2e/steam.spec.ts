import type { Page, Route } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

// e2e 服务端没有配置 STEAM_API_KEY：recent 操作真实返回 nokey，用例里改成别的状态时才打桩
const RECENT_ACTION = '/api/widgets/steam/recent';
const BIND_ACTION = '/api/widgets/steam/bind';
const UNBIND_ACTION = '/api/widgets/steam/unbind';

const steam = (page: Page) => page.locator('#w-steam');

async function stubRecent(page: Page, data: object): Promise<void> {
  await page.route(
    (url) => url.pathname === RECENT_ACTION,
    (route: Route) => route.fulfill({ json: { success: true, data, error: null } }),
  );
}

const UNBOUND = { account: undefined, sub: '最近游玩', feed: { status: 'unbound' } };

/** 打开首页；Steam 在 e2e 布局里放在手机端可折叠的「扩展插件」区域，手机端要先展开开关 */
async function gotoSteam(page: Page): Promise<void> {
  await gotoHome(page);
  const toggle = page.getByRole('button', { name: '扩展插件' });
  if (await toggle.count()) await toggle.tap();
}

test.describe('Steam', () => {
  test('没有配置 API Key 时提示环境变量', async ({ page }) => {
    await gotoSteam(page);
    await expect(steam(page).getByText('服务器还没有配置 Steam API Key')).toBeVisible();
  });

  test('未绑定账号时提示绑定，绑定表单可以取消', async ({ page }) => {
    await stubRecent(page, UNBOUND);
    await gotoSteam(page);
    await expect(steam(page).getByText('绑定 Steam 账号后')).toBeVisible();

    const toggle = steam(page).getByRole('button', { name: '绑定账号' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    const input = steam(page).getByLabel('SteamID64 或个人资料链接');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toBeFocused();

    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test('列出最近两周玩过的游戏，正在玩的显示在标题旁', async ({ page }) => {
    await stubRecent(page, {
      account: { steamId: '76561197960265729', name: 'Ash' },
      sub: '正在玩 Dota 2',
      feed: {
        status: 'ok',
        stale: false,
        rows: [
          { appId: 570, name: 'Dota 2', cover: 'https://example.com/570.jpg', meta: '今天 · 2.3 小时', detail: '累计 812 小时 · 上次 09月29日' },
          { appId: 730, name: 'CS2', cover: 'https://example.com/730.jpg', meta: '近两周 0.8 小时', detail: '累计 40 小时' },
        ],
      },
    });
    await gotoSteam(page);

    await expect(steam(page).getByText('正在玩 Dota 2')).toBeVisible();
    const list = steam(page).getByRole('list');
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').first()).toContainText('Dota 2');
    await expect(list.getByRole('listitem').first()).toContainText('2.3 小时');
    await expect(steam(page).getByText('账号：Ash')).toBeVisible();
  });

  test('最近两周没有玩游戏时显示空状态', async ({ page }) => {
    await stubRecent(page, {
      account: { steamId: '76561197960265729', name: undefined },
      sub: '最近游玩',
      feed: { status: 'ok', stale: false, rows: [] },
    });
    await gotoSteam(page);

    await expect(steam(page).getByText('最近两周没有玩游戏')).toBeVisible();
    await expect(steam(page).getByText('账号：76561197960265729')).toBeVisible();
  });

  test('读取失败时提示并可以重试', async ({ page }) => {
    let failing = true;
    await page.route(
      (url) => url.pathname === RECENT_ACTION,
      (route: Route) => {
        if (failing) {
          route.fulfill({ json: { success: true, data: { account: undefined, sub: '最近游玩', feed: { status: 'error', message: '暂时连不上 Steam，稍后再试' } }, error: null } });
        } else {
          route.fulfill({ json: { success: true, data: UNBOUND, error: null } });
        }
      },
    );
    await gotoSteam(page);
    const notice = steam(page).getByText('暂时连不上 Steam，稍后再试');
    await expect(notice).toBeVisible();

    failing = false;
    await steam(page).getByRole('button', { name: '重试' }).click();
    await expect(notice).toHaveCount(0);
    await expect(steam(page).getByText('绑定 Steam 账号后')).toBeVisible();
  });

  test('绑定失败时说明原因、表单留着；成功后刷新列表', async ({ page }) => {
    await stubRecent(page, UNBOUND);
    const sent: unknown[] = [];
    let bound = false;
    await page.route(
      (url) => url.pathname === BIND_ACTION,
      (route: Route) => {
        sent.push({ method: route.request().method(), body: route.request().postDataJSON() });
        bound = true;
        route.fulfill({ json: { success: false, data: null, error: 'SteamID64 是 7656119 开头的 17 位数字' } });
      },
    );
    await gotoSteam(page);
    await steam(page).getByRole('button', { name: '绑定账号' }).click();
    const input = steam(page).getByLabel('SteamID64 或个人资料链接');
    const save = steam(page).getByRole('button', { name: '保存' });
    await input.fill('not-a-valid-id');

    await save.click();
    await expect(steam(page).getByRole('status')).toHaveText('SteamID64 是 7656119 开头的 17 位数字');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toEqual([{ method: 'PUT', body: { account: 'not-a-valid-id' } }]);
    expect(bound).toBe(true);

    await page.unroute(BIND_ACTION);
    await page.route(
      (url) => url.pathname === BIND_ACTION,
      (route: Route) => route.fulfill({ json: { success: true, data: { steamId: '76561197960265729' }, error: null } }),
    );
    await stubRecent(page, {
      account: { steamId: '76561197960265729', name: undefined },
      sub: '最近游玩',
      feed: { status: 'unbound' },
    });
    await input.fill('76561197960265729');
    await save.click();
    await expect(steam(page).getByText('已绑定，正在读取游戏记录…')).toBeVisible();
    await expect(input).toHaveCount(0);
  });

  test('解除绑定后表单关闭，重新读取', async ({ page }) => {
    await stubRecent(page, {
      account: { steamId: '76561197960265729', name: undefined },
      sub: '最近游玩',
      feed: { status: 'ok', stale: false, rows: [] },
    });
    await page.route(
      (url) => url.pathname === UNBIND_ACTION,
      (route: Route) => route.fulfill({ json: { success: true, data: { steamId: undefined }, error: null } }),
    );
    await gotoSteam(page);
    await steam(page).getByRole('button', { name: '修改绑定' }).click();

    await stubRecent(page, UNBOUND);
    await steam(page).getByRole('button', { name: '解除绑定' }).click();
    await expect(steam(page).getByText('已解除绑定')).toBeVisible();
    await expect(steam(page).getByLabel('SteamID64 或个人资料链接')).toHaveCount(0);
    await expect(steam(page).getByText('绑定 Steam 账号后')).toBeVisible();
  });
});
