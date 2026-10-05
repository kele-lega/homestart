import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ClockView from '../../../src/widgets/clock/View.astro';
import { viewContext } from '../../helpers';

let container: AstroContainer;
type DateLine = { date: boolean; weekday: boolean; lunar: boolean; festival: boolean };
const ALL_PARTS: DateLine = { date: true, weekday: true, lunar: true, festival: true };
const render = (options: { seconds: boolean } & Partial<DateLine>) =>
  container.renderToString(ClockView, {
    props: { id: 'clock', options: { ...ALL_PARTS, ...options }, ...viewContext({ timezone: 'Asia/Shanghai' }) },
  });
const lineText = (html: string, kind: 'day' | 'lunar') =>
  new RegExp(`<p class="line ${kind}[^>]*>([\\s\\S]*?)</p>`).exec(html)?.[1]?.replace(/<[^>]+>/g, '');
const lines = (html: string) => [lineText(html, 'day'), lineText(html, 'lunar')];

beforeAll(async () => {
  container = await AstroContainer.create();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T06:05:09Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('clock view', () => {
  it('renders the current time in the site time zone for the first paint', async () => {
    const html = await render({ seconds: false });

    expect(html).toContain('data-timezone="Asia/Shanghai"');
    expect(html).toMatch(/<time[^>]*datetime="2026-09-29T06:05:09.000Z"/);
    expect(html).toMatch(/data-part="hours"[^>]*>14</);
    expect(html).toMatch(/data-part="minutes"[^>]*>05</);
    expect(html).toMatch(/data-part="date"[^>]*>2026\.09\.29</);
    expect(html).toMatch(/data-part="weekday"[^>]*>周二</);
    expect(html).not.toContain('data-part="seconds"');
  });

  it('puts the date on one line and the lunar day on the next, keeping the spaces', async () => {
    // 2026-09-29 是农历八月十九；构建时会删掉标签之间带换行的空白，空格要显式写出来
    expect(lines(await render({ seconds: false }))).toEqual(['2026.09.29 周二', '八月十九']);
  });

  it('has no greeting any more', async () => {
    const html = await render({ seconds: false });

    expect(html).not.toContain('data-part="greeting"');
    expect(html).not.toContain('class="greet');
  });

  it('shows seconds when configured', async () => {
    const html = await render({ seconds: true });

    expect(html).toMatch(/data-part="seconds"[^>]*>09</);
  });

  it('gives every pair of digits a fixed-width box so ticking does not shift the header', async () => {
    const html = await render({ seconds: true });

    for (const part of ['hours', 'minutes', 'seconds']) {
      expect(html).toMatch(new RegExp(`class="digits[^"]*" data-part="${part}"`));
    }
  });

  it('drops the parts of the date lines that are switched off', async () => {
    vi.setSystemTime(new Date('2026-10-01T02:00:00Z'));

    expect(lines(await render({ seconds: false }))).toEqual(['2026.10.01 周四', '八月廿一 · 国庆']);
    expect(lines(await render({ seconds: false, date: false }))).toEqual(['周四', '八月廿一 · 国庆']);
    expect(lines(await render({ seconds: false, weekday: false, festival: false }))).toEqual(['2026.10.01', '八月廿一']);
    expect(lines(await render({ seconds: false, date: false, weekday: false }))).toEqual([undefined, '八月廿一 · 国庆']);
    expect(lines(await render({ seconds: false, lunar: false, festival: false }))).toEqual(['2026.10.01 周四', undefined]);
  });

  it('leaves both lines out when every part is off', async () => {
    const html = await render({ seconds: false, date: false, weekday: false, lunar: false, festival: false });

    expect(html).not.toContain('class="line');
    expect(html).toMatch(/data-part="hours"/);
  });
});
