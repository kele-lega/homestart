import type { Page } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

// 区块和挂件框没有可访问名称（很多没有标题），用渲染器生成的稳定 id：z-<区块 id> / w-<挂件 id>
// 与 e2e/fixtures/config/layout.yaml 的 page.mobile.order 一致；side、main 是 flatten 区块，按里面的挂件排。
// DOM 顺序是 header、nav、notes、todo、calendar、agenda、deadline、favorites、extras，和这里不同
const MOBILE_ORDER = [
  'z-header',
  'z-nav',
  'w-favorites',
  'w-todo',
  'w-deadline',
  'z-extras',
  'w-notes',
  'w-calendar',
  'w-agenda',
];
// 子像素取整的容差
const EPS = 2;

type Box = { x: number; y: number; width: number; height: number };

// 时钟的外框在和天气合成的卡片里是 display: contents，自己没有盒子：量里面的时间和日期
const PARTS: Readonly<Record<string, string>> = { 'w-clock-time': '#w-clock .time', 'w-clock-day': '#w-clock .day' };
const selectorOf = (id: string) => PARTS[id] ?? `[id="${id}"]`;

/** 字体就绪后一次性量出所有盒子，避免逐个测量时中途重排 */
async function measure(page: Page, ids: readonly string[]): Promise<Box[]> {
  for (const id of ids) await expect(page.locator(selectorOf(id))).toBeVisible();
  return page.evaluate(async (selectors) => {
    await document.fonts.ready;
    return selectors.map((selector) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  }, ids.map(selectorOf));
}

const bottom = (rect: Box) => rect.y + rect.height;
const right = (rect: Box) => rect.x + rect.width;
const middleY = (rect: Box) => rect.y + rect.height / 2;

test.describe('布局', () => {
  test('手机端按 page.mobile.order 自上而下排列', { tag: '@mobile' }, async ({ page }) => {
    await gotoHome(page);
    const boxes = await measure(page, MOBILE_ORDER);

    for (let i = 1; i < boxes.length; i++) {
      const [previous, current] = [boxes[i - 1]!, boxes[i]!];
      expect(current.y, `${MOBILE_ORDER[i]} 应在 ${MOBILE_ORDER[i - 1]} 下方`).toBeGreaterThanOrEqual(bottom(previous) - EPS);
    }
  });

  test('手机端页头：时间和天气在左、三个圆在右，搜索框占满下一行', { tag: '@mobile' }, async ({ page }) => {
    await gotoHome(page);
    const [time, weather, toolbar, search] = await measure(page, ['w-clock-time', 'w-weather', 'w-toolbar', 'w-search']);

    expect(weather.x).toBeGreaterThanOrEqual(right(time) - EPS);
    expect(toolbar.x).toBeGreaterThanOrEqual(right(weather) - EPS);
    expect(search.y).toBeGreaterThanOrEqual(Math.max(bottom(time), bottom(weather), bottom(toolbar)) - EPS);
    expect(Math.abs(search.x - time.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(right(search) - right(toolbar))).toBeLessThanOrEqual(EPS);
  });

  test('手机端页面不会横向伸出视口，哪怕有元素超宽', { tag: '@mobile' }, async ({ page }) => {
    await gotoHome(page);
    const widthOf = () =>
      page.evaluate(() => {
        scrollTo(9999, scrollY);
        const root = document.documentElement;
        return { scroll: root.scrollWidth, client: root.clientWidth, x: scrollX };
      });

    const plain = await widthOf();
    expect(plain.scroll).toBeLessThanOrEqual(plain.client);

    // 模拟一段 nowrap 的长内容伸出右边：页面仍然不能被撑宽、也不能横着滚
    await page.locator('#w-favorites').evaluate((el) => {
      const wide = document.createElement('span');
      wide.style.cssText = 'position:absolute;inset-inline-start:0;white-space:nowrap';
      wide.textContent = '很长很长的一段不换行的文字'.repeat(10);
      el.append(wide);
    });
    const wide = await widthOf();
    expect(wide.scroll).toBeLessThanOrEqual(wide.client);
    expect(wide.x).toBe(0);
  });

  test('桌面端各区块落在 page.desktop.areas 指定的格子里', { tag: '@desktop' }, async ({ page }) => {
    await gotoHome(page);
    const [header, nav, side, main, extras] = await measure(page, ['z-header', 'z-nav', 'z-side', 'z-main', 'z-extras']);

    // "header header"：独占第一行、横跨两列
    expect(nav.y).toBeGreaterThanOrEqual(bottom(header) - EPS);
    expect(Math.abs(header.x - side.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(right(header) - right(main))).toBeLessThanOrEqual(EPS);
    // "nav nav"：紧挨在页头下面单独一排、横跨两列，其余区块都在它下面
    expect(Math.abs(nav.x - header.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(right(nav) - right(header))).toBeLessThanOrEqual(EPS);
    expect(side.y).toBeGreaterThanOrEqual(bottom(nav) - EPS);
    expect(main.y).toBeGreaterThanOrEqual(bottom(nav) - EPS);
    // "side main" / "side extras"：side 在左列，main 与 extras 在右列上下排
    expect(main.x).toBeGreaterThanOrEqual(right(side) - EPS);
    expect(Math.abs(main.x - extras.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(main.y - side.y)).toBeLessThanOrEqual(EPS);
    expect(extras.y).toBeGreaterThanOrEqual(bottom(main) - EPS);
    // side 跨两行：延伸到 extras 那一行
    expect(bottom(side)).toBeGreaterThan(extras.y);
  });

  test('桌面端页头：时间和天气、搜索、三个圆一行；搜索框正好在正中，天气在日期下面', { tag: '@desktop' }, async ({ page }) => {
    await gotoHome(page);
    const [header, time, weather, search, toolbar] = await measure(page, ['z-header', 'w-clock-time', 'w-weather', 'w-search', 'w-toolbar']);
    const [day] = await measure(page, ['w-clock-day']);

    expect(search.x).toBeGreaterThanOrEqual(right(weather) - EPS);
    expect(toolbar.x).toBeGreaterThanOrEqual(right(search) - EPS);
    // 两侧等宽：搜索栏的中线就是页头的中线，跟时钟、天气多宽无关
    expect(Math.abs(search.x + search.width / 2 - (header.x + header.width / 2))).toBeLessThanOrEqual(EPS);
    // 天气在原来问候语的位置：日期下面、时间右边
    expect(weather.x).toBeGreaterThanOrEqual(right(time) - EPS);
    expect(Math.abs(weather.x - day.x)).toBeLessThanOrEqual(EPS);
    expect(weather.y).toBeGreaterThanOrEqual(bottom(day) - EPS);
    expect(Math.abs(middleY(toolbar) - middleY(time))).toBeLessThan(time.height);
  });

  test('窄窗口页头：搜索框换到第二行占满，三个圆还在右上', { tag: '@desktop' }, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await gotoHome(page);
    const [header, time, toolbar, search] = await measure(page, ['z-header', 'w-clock-time', 'w-toolbar', 'w-search']);

    expect(search.y).toBeGreaterThanOrEqual(Math.max(bottom(time), bottom(toolbar)) - EPS);
    expect(Math.abs(search.x - header.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(right(search) - right(header))).toBeLessThanOrEqual(EPS);
    expect(Math.abs(right(toolbar) - right(header))).toBeLessThanOrEqual(EPS);
  });
});
