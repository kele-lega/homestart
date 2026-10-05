import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { E2E_ADMIN, E2E_CAPTCHA } from './e2e/support/accounts';

// E2E 单独构建到 dist/e2e、单独起在 4329 端口，不碰 dist/client、dist/server 和 4321 上的服务
const PORT = 4329;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CONFIG_DIR = fileURLToPath(new URL('./e2e/fixtures/config', import.meta.url));
// 不存在的文件读作「谁都没订阅」；订阅接口在用例里打桩，不会真的写入
const CALENDAR_USERS = fileURLToPath(new URL('./dist/e2e/calendar-users.json', import.meta.url));
// 自己添加的日程真的会写；每个用例用新建的账号，互不影响
const CALENDAR_EVENTS = fileURLToPath(new URL('./dist/e2e/calendar-events.json', import.meta.url));
// 写回 Google 日历的设置：用例只走到「拿到脚本」，不真的连 Google
const CALENDAR_SYNC = fileURLToPath(new URL('./dist/e2e/calendar-sync.json', import.meta.url));
const STEAM_USERS = fileURLToPath(new URL('./dist/e2e/steam-users.json', import.meta.url));
// 设置页的用例真的会存偏好：写进构建目录，每次 e2e:build 重新构建时随 dist/e2e 一起清掉
const PREFERENCES = fileURLToPath(new URL('./dist/e2e/preferences.json', import.meta.url));
const LINK_VISITS = fileURLToPath(new URL('./dist/e2e/link-visits.json', import.meta.url));
const USER_LINKS = fileURLToPath(new URL('./dist/e2e/user-links.json', import.meta.url));
const SITE_ICONS = fileURLToPath(new URL('./dist/e2e/site-icons', import.meta.url));
// 上传头像的用例真的会写文件：同样放进构建目录
const AVATARS = fileURLToPath(new URL('./dist/e2e/avatars', import.meta.url));
// 公告用例真的会发布、删除；每条标题带上项目名和启动时刻，留下来的也不影响下一轮
const ANNOUNCEMENTS = fileURLToPath(new URL('./dist/e2e/announcements.json', import.meta.url));
// 本站计数、建议同样真的会写；计数用例只断言「加了一」，建议正文带项目名和启动时刻
const SITE_STATS = fileURLToPath(new URL('./dist/e2e/site-stats.json', import.meta.url));
const SUGGESTIONS = fileURLToPath(new URL('./dist/e2e/suggestions.json', import.meta.url));
// 用本机已装的 Chrome，不下载 Playwright 自带的浏览器
const CHANNEL = 'chrome';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // 外部请求全部打桩，没有要等网络的用例：单个用例、断言、整轮各自设上限，卡住就尽快失败
  timeout: 15_000,
  expect: { timeout: 5_000 },
  globalTimeout: 600_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  // 只适用于一端的用例带 @desktop / @mobile 标签，在另一端直接不收录
  projects: [
    {
      name: 'desktop',
      grepInvert: /@mobile/,
      use: { channel: CHANNEL, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      grepInvert: /@desktop/,
      use: {
        channel: CHANNEL,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  // 只启动已构建好的 dist/e2e（构建见 npm run e2e:build），调试单个用例时不必每次重新构建
  webServer: {
    command: 'node dist/e2e/server/entry.mjs',
    url: `${BASE_URL}/`,
    // 请求没有身份头，一律按匿名用户处理：不读开发者本机的 HOME_DEV_USER 和日历订阅，服务端从不去取 ICS
    env: {
      HOST: '127.0.0.1',
      PORT: String(PORT),
      CONFIG_DIR,
      HOME_DEV_USER: '',
      CALENDAR_USERS_FILE: CALENDAR_USERS,
      CALENDAR_EVENTS_FILE: CALENDAR_EVENTS,
      CALENDAR_SYNC_FILE: CALENDAR_SYNC,
      STEAM_USERS_FILE: STEAM_USERS,
      PREFERENCES_FILE: PREFERENCES,
      LINK_VISITS_FILE: LINK_VISITS,
      USER_LINKS_FILE: USER_LINKS,
      SITE_ICONS_DIR: SITE_ICONS,
      AVATARS_DIR: AVATARS,
      ANNOUNCEMENTS_FILE: ANNOUNCEMENTS,
      SITE_STATS_FILE: SITE_STATS,
      SUGGESTIONS_FILE: SUGGESTIONS,
      // 建议的验证码每道题答案都是这个，用例才填得上；生产环境不设置
      SUGGESTION_CAPTCHA_FIXED: E2E_CAPTCHA,
      // 每次点开网站、搜索都算一次，全从本机来，同样放宽
      SITE_HIT_RATE_LIMIT: '2000',
      // 没有配置 Key：recent 操作一律回 nokey，不会真的请求 Steam
      STEAM_API_KEY: '',
      // 整轮 73 个用例共用同一个匿名用户 key，都算进限流的同一个窗口；调大到用不着的量级，不改变生产环境的默认值
      WIDGET_ACTION_RATE_LIMIT: '2000',
      // 登录用内存库，每次启动都是空的，只有这个管理员；登录限流按来源地址计数，e2e 全从本机来，同样放宽
      AUTH_DB_FILE: ':memory:',
      INITIAL_ADMIN_USER: E2E_ADMIN.username,
      INITIAL_ADMIN_PASSWORD: E2E_ADMIN.password,
      AUTH_LOGIN_RATE_LIMIT: '2000',
    },
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
