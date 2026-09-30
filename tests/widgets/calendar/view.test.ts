import { getContainerRenderer } from '@astrojs/svelte/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetHeading } from '../../../src/core/widget';
import CalendarView from '../../../src/widgets/calendar/View.astro';
import { viewContext } from '../../helpers';

// 上海 2026-09-29 12:00，星期二
const NOON = Date.UTC(2026, 8, 29, 4);
const HEADING: WidgetHeading = { title: '日历', level: 3 };

let container: AstroContainer;
/** 不传 heading 就是实例没有标题 */
const render = ({ heading, site }: { heading?: WidgetHeading; site?: unknown } = { heading: HEADING }) =>
  container.renderToString(CalendarView, { props: { id: 'cal', options: {}, heading, ...viewContext(site) } });

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
const dateOf = (tag: string) => /data-date="([\d-]+)"/.exec(tag)?.[1];
const cellTag = (html: string, date: string) => buttons(html).find((tag) => dateOf(tag) === date) ?? '';
/** 带某个 class 的格子的日期 */
const cellsWith = (html: string, name: string) =>
  buttons(html)
    .filter((tag) => new RegExp(`class="[^"]*\\b${name}\\b`).test(tag))
    .map(dateOf)
    .filter(Boolean);

beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('calendar view', () => {
  it('draws the head and the month it shows', async () => {
    const html = await render();

    // Svelte 在动态标签的文字后面留一个 <!----> 标记
    expect(html).toMatch(/<h3 class="l-frame-title[^"]*">日历(?:<!---->)?<\/h3>/);
    expect(html).toContain('2026 · 九月');
    expect(html).toMatch(/<span class="m[^"]*" aria-hidden="true">09<\/span>/);
    expect(html).toContain('2026年9月');
  });

  it("draws this month's weeks on the server, Monday first", async () => {
    const html = await render();
    const dates = buttons(html).map(dateOf).filter(Boolean);

    expect(html.match(/class="wd[ "]/g)).toHaveLength(7);
    expect(dates).toHaveLength(35);
    expect(dates[0]).toBe('2026-08-31');
    expect(dates.at(-1)).toBe('2026-10-04');
    expect(cellsWith(html, 'out')).toEqual(['2026-08-31', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('lets Tab enter the grid on today only', async () => {
    const html = await render();
    const today = cellTag(html, '2026-09-29');

    expect(cellsWith(html, 'today')).toEqual(['2026-09-29']);
    expect(today).toContain('tabindex="0"');
    expect(today).toContain('aria-label="9月29日 星期二，今天，农历');
    expect(today).toContain('aria-pressed="false"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it('leaves the events and the subscription to the browser', async () => {
    const html = await render();

    expect(html).toMatch(/<astro-island[^>]*client="load"/);
    expect(html).toContain('正在读取日程…');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('添加订阅');
    expect(html).not.toContain('修改订阅');
    expect(html).not.toMatch(/class="cal-day[ "]/);
    expect(html).not.toContain('<form');
  });

  it('offers no way back to this month while showing it', async () => {
    const html = await render();

    expect(html).not.toContain('回到本月');
    expect(html).toMatch(/<button[^>]*aria-label="上个月"/);
    expect(html).not.toMatch(/<button[^>]*aria-label="上个月"[^>]*disabled/);
    expect(html).not.toMatch(/<button[^>]*aria-label="下个月"[^>]*disabled/);
  });

  it('stops paging at the last supported month', async () => {
    vi.setSystemTime(Date.UTC(2099, 11, 15));
    const html = await render();

    expect(html).toMatch(/<button[^>]*aria-label="下个月"[^>]*disabled/);
    expect(html).not.toMatch(/<button[^>]*aria-label="上个月"[^>]*disabled/);
  });

  it('leaves the head out when the instance has no title', async () => {
    const html = await render({});

    expect(html).not.toContain('l-frame-title');
    expect(html).toContain('2026年9月');
  });

  it('follows the site time zone across midnight', async () => {
    // 上海已经是 10 月 1 日，UTC 还是 9 月 30 日
    vi.setSystemTime(Date.UTC(2026, 8, 30, 16, 30));
    const shanghai = await render();
    const utc = await render({ heading: HEADING, site: { timezone: 'UTC' } });

    expect(shanghai).toContain('2026 · 十月');
    expect(cellsWith(shanghai, 'today')).toEqual(['2026-10-01']);
    expect(buttons(shanghai).map(dateOf).filter(Boolean)).toHaveLength(35);
    expect(utc).toContain('2026 · 九月');
    expect(cellsWith(utc, 'today')).toEqual(['2026-09-30']);
  });
});
