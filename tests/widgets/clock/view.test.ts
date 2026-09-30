import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ClockView from '../../../src/widgets/clock/View.astro';
import { viewContext } from '../../helpers';

let container: AstroContainer;
const render = (options: { seconds: boolean; greeting: boolean; name?: string }) =>
  container.renderToString(ClockView, {
    props: { id: 'clock', options, ...viewContext({ timezone: 'Asia/Shanghai' }) },
  });

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
    const html = await render({ seconds: false, greeting: true });

    expect(html).toContain('data-timezone="Asia/Shanghai"');
    expect(html).toMatch(/<time[^>]*datetime="2026-09-29T06:05:09.000Z"/);
    expect(html).toMatch(/data-part="hours"[^>]*>14</);
    expect(html).toMatch(/data-part="minutes"[^>]*>05</);
    expect(html).toMatch(/data-part="date"[^>]*>2026\.09\.29</);
    expect(html).toMatch(/data-part="weekday"[^>]*>周二</);
    // 2026-09-29 是农历八月十九
    expect(html).toContain('· 八月十九');
    expect(html).toMatch(/data-part="greeting"[^>]*>下午好</);
    expect(html).not.toContain('data-part="seconds"');
  });

  it('keeps the spaces between date, weekday and lunar day', async () => {
    const html = await render({ seconds: false, greeting: true });
    const line = /<p class="date[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';

    // 构建时会删掉标签之间带换行的空白，空格要显式写出来
    expect(line.replace(/<[^>]+>/g, '')).toBe('2026.09.29 周二 · 八月十九');
  });

  it('shows seconds and hides the greeting when configured', async () => {
    const html = await render({ seconds: true, greeting: false });

    expect(html).toMatch(/data-part="seconds"[^>]*>09</);
    expect(html).not.toContain('data-part="greeting"');
  });

  it('appends the configured name to the greeting', async () => {
    const html = await render({ seconds: false, greeting: true, name: '冲凉' });

    expect(html).toMatch(/data-part="greeting"[^>]*>下午好<\/span>，冲凉/);
  });
});
