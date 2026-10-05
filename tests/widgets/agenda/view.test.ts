import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayEntry } from '../../../src/adapters/calendar/days';
import { loadWidgetData } from '../../../src/core/widget-data';
import type { WidgetHeading } from '../../../src/core/widget';
import Live from '../../../src/widgets/agenda/Live.astro';
import type { AgendaData } from '../../../src/widgets/agenda/widget';
import { withoutDevAnnotations } from '../../helpers';

// View.astro 的 server:defer 在 AstroContainer 里渲染不了（见 weather/view.test.ts），只测 island 本身
vi.mock('../../../src/core/widget-data', () => ({ loadWidgetData: vi.fn() }));
vi.mock('../../../src/core/runtime', () => ({ loadConfig: vi.fn() }));

// 上海 2026-09-29 12:00
const NOON = Date.UTC(2026, 8, 29, 4);
const at = (hour: number, minute = 0) => Date.UTC(2026, 8, 29, hour - 8, minute);
const HEADING: WidgetHeading = { title: '今天', level: 3 };

const entry = (title: string, fields: Partial<DayEntry>): DayEntry => ({
  id: title,
  title,
  location: undefined,
  time: '全天',
  until: undefined,
  timing: undefined,
  ...fields,
});

const ENTRIES = [
  entry('中秋', {}),
  entry('通宵', { time: '—', until: '01:30', location: '家', timing: { start: at(-2), end: at(1, 30) } }),
  entry('早饭', { time: '08:00', timing: { start: at(8), end: at(8, 30) } }),
  entry('组会', { time: '14:00', location: '三楼', timing: { start: at(14), end: at(15) } }),
  entry('晚饭', { time: '18:00', timing: { start: at(18), end: at(19) } }),
];

let container: AstroContainer;
/** 不传 heading 就是实例没有标题 */
const renderLive = async (data: AgendaData | undefined, props: { heading?: WidgetHeading } = { heading: HEADING }) => {
  vi.mocked(loadWidgetData).mockResolvedValue(data ? { ok: true, data } : { ok: false });
  return withoutDevAnnotations(await container.renderToString(Live, { props: { id: 'agenda', ...props } }));
};
const items = (html: string) => [...html.matchAll(/<li[^>]*>[\s\S]*?<\/li>/g)].map((match) => match[0]);
const stateOf = (item: string) => /data-state="(\w+)"/.exec(item)?.[1];

beforeAll(async () => {
  container = await AstroContainer.create();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  vi.mocked(loadWidgetData).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('agenda island', () => {
  it('draws the head with the number of entries', async () => {
    const html = await renderLive({ status: 'ok', data: ENTRIES, stale: false });

    expect(html).toMatch(/<h3 class="l-frame-title">今天<\/h3>/);
    expect(html).toContain('5 件日程');
  });

  it('marks what is over and what comes next as of the first render', async () => {
    const rows = items(await renderLive({ status: 'ok', data: ENTRIES, stale: false }));

    expect(rows.map(stateOf)).toEqual([undefined, 'done', 'done', 'next', undefined]);
    expect(rows[0]).not.toContain('data-start');
    expect(rows[3]).toContain(`data-start="${at(14)}"`);
    expect(rows[3]).toContain(`data-end="${at(15)}"`);
  });

  it('wraps the rows in <agenda-list>, the element View.astro updates every minute', async () => {
    const html = await renderLive({ status: 'ok', data: ENTRIES, stale: false });

    expect(html).toMatch(/<agenda-list[^>]*>\s*<ol class="ev-list" role="list"[^>]*>[\s\S]*<\/ol>\s*<\/agenda-list>/);
  });

  it('labels an entry carried over from yesterday and shows when it ends', async () => {
    const [, carried, , meeting] = items(await renderLive({ status: 'ok', data: ENTRIES, stale: false }));

    expect(carried).toMatch(/<span aria-hidden="true">—<\/span><span class="visually-hidden">接前一天<\/span>/);
    expect(carried).toContain('至 01:30 · 家');
    expect(meeting).toContain('三楼');
    expect(meeting).not.toContain('至 ');
  });

  it('says the day is free, without a count, when there is nothing today', async () => {
    const html = await renderLive({ status: 'ok', data: [], stale: false });

    expect(html).toContain('今天没有日程');
    expect(html).not.toContain('件日程');
  });

  it('shows nothing at all for a visitor: no subscription notice, no empty day', async () => {
    const html = await renderLive({ status: 'unconfigured' });

    expect(html).not.toContain('还没有订阅日历');
    expect(html).not.toContain('feed-notice');
    expect(html).not.toContain('今天没有日程');
  });

  it('keeps the head but says the schedule is unavailable when loading failed', async () => {
    const html = await renderLive(undefined);

    expect(html).toContain('l-frame-title');
    expect(html).toMatch(/data-kind="error"[^>]*>\s*今天的日程暂时不可用/);
    expect(html).not.toContain('件日程');
  });

  it('draws no head when the instance has no title', async () => {
    const html = await renderLive({ status: 'ok', data: ENTRIES, stale: false }, {});

    expect(html).not.toContain('l-frame-head');
    expect(items(html)).toHaveLength(5);
  });
});
