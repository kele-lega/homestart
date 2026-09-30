import type { Page } from '@playwright/test';
import { expect, gotoHome, test } from './support/fixtures';

// 区块和挂件框没有可访问名称（很多没有标题），用渲染器生成的稳定 id：z-<区块 id> / w-<挂件 id>
// 与 e2e/fixtures/config/layout.yaml 的 page.mobile.order 一致；side、main 是 flatten 区块，按里面的挂件排。
// DOM 顺序是 header、notes、todo、calendar、agenda、deadline、favorites、extras、footer，和这里不同
const MOBILE_ORDER = [
  'z-header',
  'w-favorites',
  'w-todo',
  'w-deadline',
  'z-extras',
  'w-notes',
  'w-calendar',
  'w-agenda',
  'z-footer',
];
// 子像素取整的容差
const EPS = 2;

type Box = { x: number; y: number; width: number; height: number };

/** 字体就绪后一次性量出所有盒子，避免逐个测量时中途重排 */
async function measure(page: Page, ids: readonly string[]): Promise<Box[]> {
  for (const id of ids) await expect(page.locator(`[id="${id}"]`)).toBeVisible();
  return page.evaluate(async (list) => {
    await document.fonts.ready;
    return list.map((id) => {
      const rect = document.getElementById(id)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  }, ids);
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

  test('手机端页头：时钟和天气同一行，搜索框占满下一行', { tag: '@mobile' }, async ({ page }) => {
    await gotoHome(page);
    const [clock, weather, search] = await measure(page, ['w-clock', 'w-weather', 'w-search']);

    expect(weather.x).toBeGreaterThanOrEqual(right(clock) - EPS);
    expect(Math.abs(middleY(weather) - middleY(clock))).toBeLessThan(clock.height / 2);
    expect(search.y).toBeGreaterThanOrEqual(Math.max(bottom(clock), bottom(weather)) - EPS);
    expect(Math.abs(search.x - clock.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(right(search) - right(weather))).toBeLessThanOrEqual(EPS);
  });

  test('桌面端各区块落在 page.desktop.areas 指定的格子里', { tag: '@desktop' }, async ({ page }) => {
    await gotoHome(page);
    const [header, side, main, extras, footer] = await measure(page, ['z-header', 'z-side', 'z-main', 'z-extras', 'z-footer']);

    // "header header"：独占第一行、横跨两列
    expect(side.y).toBeGreaterThanOrEqual(bottom(header) - EPS);
    expect(Math.abs(header.x - side.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(right(header) - right(main))).toBeLessThanOrEqual(EPS);
    // "side main" / "side extras"：side 在左列，main 与 extras 在右列上下排
    expect(main.x).toBeGreaterThanOrEqual(right(side) - EPS);
    expect(Math.abs(main.x - extras.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(main.y - side.y)).toBeLessThanOrEqual(EPS);
    expect(extras.y).toBeGreaterThanOrEqual(bottom(main) - EPS);
    // side 跨两行：延伸到 extras 那一行
    expect(bottom(side)).toBeGreaterThan(extras.y);
    // "footer footer"：在最下面、横跨两列
    expect(footer.y).toBeGreaterThanOrEqual(Math.max(bottom(side), bottom(extras)) - EPS);
    expect(Math.abs(footer.x - header.x)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(right(footer) - right(header))).toBeLessThanOrEqual(EPS);
  });

  test('桌面端页头：时钟、搜索、天气从左到右一行', { tag: '@desktop' }, async ({ page }) => {
    await gotoHome(page);
    const [clock, search, weather] = await measure(page, ['w-clock', 'w-search', 'w-weather']);

    expect(search.x).toBeGreaterThanOrEqual(right(clock) - EPS);
    expect(weather.x).toBeGreaterThanOrEqual(right(search) - EPS);
    expect(Math.abs(middleY(search) - middleY(clock))).toBeLessThan(clock.height / 2);
    expect(Math.abs(middleY(weather) - middleY(clock))).toBeLessThan(clock.height / 2);
  });
});
