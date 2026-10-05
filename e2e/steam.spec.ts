import type { Page, Route } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

// e2e 服务端没有配置 STEAM_API_KEY：recent 操作真实返回 nokey，用例里改成别的状态时才打桩
// 绑定账号在设置页里（e2e/settings.spec.ts），这里只看卡片怎么显示
const RECENT_ACTION = '/api/widgets/steam/recent';

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

  test('未绑定账号时提示绑定，链接到设置页；卡片上没有绑定表单', async ({ page }) => {
    await stubRecent(page, UNBOUND);
    await gotoSteam(page);
    await expect(steam(page).getByText('绑定 Steam 账号后')).toBeVisible();
    await expect(steam(page).getByRole('link', { name: '去绑定' })).toHaveAttribute('href', '/settings#steam');
    await expect(steam(page).getByRole('textbox')).toHaveCount(0);
    await expect(steam(page).getByRole('button', { name: /绑定/ })).toHaveCount(0);
  });

  test('列出最近两周玩过的游戏，正在玩的显示在标题旁', async ({ page }) => {
    await stubRecent(page, {
      account: { steamId: '76561197960265729', name: 'Ash' },
      sub: '正在玩 Dota 2',
      feed: {
        status: 'ok',
        stale: false,
        rows: [
          { appId: 570, name: 'Dota 2', cover: 'https://example.com/570.jpg', coverFallback: 'https://example.com/570-h.jpg', meta: '今天 · 2.3 小时', detail: '累计 812 小时 · 上次 09月29日' },
          { appId: 730, name: 'CS2', cover: 'https://example.com/730.jpg', coverFallback: 'https://example.com/730-h.jpg', meta: '近两周 0.8 小时', detail: '累计 40 小时' },
        ],
      },
    });
    await gotoSteam(page);

    await expect(steam(page).getByText('正在玩 Dota 2')).toBeVisible();
    const list = steam(page).getByRole('list');
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').first()).toContainText('Dota 2');
    await expect(list.getByRole('listitem').first()).toContainText('2.3 小时');
    // 绑的是哪个账号只在设置页显示，卡片上不再有账号这一行
    await expect(steam(page).getByText(/账号：/)).toHaveCount(0);
  });

  test('手机端读屏用的详细时长不伸出卡片', { tag: '@mobile' }, async ({ page }) => {
    const detail = '累计 1234.5 小时 · 上次 09月29日 · 很长很长的一段说明文字';
    await stubRecent(page, {
      account: { steamId: '76561197960265729', name: 'Ash' },
      sub: '最近游玩',
      feed: {
        status: 'ok',
        stale: false,
        rows: [{ appId: 570, name: 'Dota 2', cover: 'https://example.com/570.jpg', coverFallback: 'https://example.com/570h.jpg', meta: '今天 · 2.3 小时', detail }],
      },
    });
    await gotoSteam(page);
    await expect(steam(page).getByText(detail)).toBeAttached();

    // 没有指针时详细说明只是视觉上隐藏：盒子要收起来，不然 nowrap 的长句会把手机页面撑宽
    const [card, long] = await Promise.all([steam(page).boundingBox(), steam(page).getByText(detail).boundingBox()]);
    expect(long!.x + long!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
  });

  test('最近两周没有玩游戏时显示空状态', async ({ page }) => {
    await stubRecent(page, {
      account: { steamId: '76561197960265729', name: undefined },
      sub: '最近游玩',
      feed: { status: 'ok', stale: false, rows: [] },
    });
    await gotoSteam(page);

    await expect(steam(page).getByText('最近两周没有玩游戏')).toBeVisible();
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
});
