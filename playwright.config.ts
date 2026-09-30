import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// E2E 单独构建到 dist/e2e、单独起在 4329 端口，不碰 dist/client、dist/server 和 4321 上的服务
const PORT = 4329;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CONFIG_DIR = fileURLToPath(new URL('./e2e/fixtures/config', import.meta.url));
// 不存在的文件读作「谁都没订阅」；订阅接口在用例里打桩，不会真的写入
const CALENDAR_USERS = fileURLToPath(new URL('./dist/e2e/calendar-users.json', import.meta.url));
const STEAM_USERS = fileURLToPath(new URL('./dist/e2e/steam-users.json', import.meta.url));
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
  globalTimeout: 180_000,
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
      STEAM_USERS_FILE: STEAM_USERS,
      // 没有配置 Key：recent 操作一律回 nokey，不会真的请求 Steam
      STEAM_API_KEY: '',
      // 整轮 73 个用例共用同一个匿名用户 key，都算进限流的同一个窗口；调大到用不着的量级，不改变生产环境的默认值
      WIDGET_ACTION_RATE_LIMIT: '2000',
    },
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
