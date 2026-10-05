import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidgetData } from '../../../src/core/widget-data';
import Live from '../../../src/widgets/deadline/Live.astro';
import type { DeadlineData } from '../../../src/widgets/deadline/widget';
import { withoutDevAnnotations } from '../../helpers';

// View.astro 的 server:defer 在 AstroContainer 里渲染不了（见 weather/view.test.ts），只测 island 本身
vi.mock('../../../src/core/widget-data', () => ({ loadWidgetData: vi.fn() }));
vi.mock('../../../src/core/runtime', () => ({ loadConfig: vi.fn() }));

const ROWS = [
  { id: 'a', title: '交稿', daysLeft: 1, date: '2026-09-30', dateText: '09.30 周三', note: '明天就截止' },
  { id: 'b', title: '续费域名', daysLeft: 10, date: '2026-10-09', dateText: '10.09 周五', note: undefined },
];

let container: AstroContainer;
const renderLive = async (data: DeadlineData | undefined) => {
  vi.mocked(loadWidgetData).mockResolvedValue(data ? { ok: true, data } : { ok: false });
  const html = await container.renderToString(Live, {
    props: { id: 'deadline' },
    request: new Request('http://localhost/', { headers: { 'x-authenticated-user': 'alice' } }),
  });
  return withoutDevAnnotations(html);
};
const items = (html: string) => [...html.matchAll(/<li[^>]*>[\s\S]*?<\/li>/g)].map((match) => match[0]);

beforeAll(async () => {
  container = await AstroContainer.create();
});

beforeEach(() => {
  vi.mocked(loadWidgetData).mockReset();
});

describe('deadline island', () => {
  it('loads this instance for the signed-in user and lists the rows in order', async () => {
    const html = await renderLive({ status: 'ok', data: ROWS, stale: false });

    const [, id, deps] = vi.mocked(loadWidgetData).mock.calls[0]!;
    expect(id).toBe('deadline');
    expect(deps).toMatchObject({ user: 'alice' });
    const [first, second] = items(html);
    expect(items(html)).toHaveLength(2);
    expect(first).toMatch(/<b>1<\/b>天<span class="visually-hidden">后截止<\/span>/);
    expect(first).toContain('交稿');
    expect(first).toMatch(/<time[^>]*datetime="2026-09-30"[^>]*>\s*09\.30 周三\s*<\/time>/);
    expect(second).toContain('<b>10</b>');
    expect(second).toContain('续费域名');
  });

  it('marks the urgent row and adds the red note only there', async () => {
    const [first, second] = items(await renderLive({ status: 'ok', data: ROWS, stale: false }));

    expect(first).toMatch(/<li[^>]*data-urgent/);
    expect(first).toContain('明天就截止');
    expect(first).toMatch(/<span aria-hidden="true">← <\/span>/);
    expect(second).not.toContain('data-urgent');
    expect(second).not.toContain('dl-note');
  });

  it('says there is nothing due when the subscription has no upcoming items', async () => {
    const html = await renderLive({ status: 'ok', data: [], stale: false });

    expect(html).toContain('接下来没有要截止的事项');
    expect(html).not.toContain('<ul');
  });

  it('says nothing to a visitor and explains a failing subscription', async () => {
    const unconfigured = await renderLive({ status: 'unconfigured' });
    expect(unconfigured).not.toContain('还没有订阅日历');
    expect(unconfigured).not.toContain('/settings#calendar');
    expect(unconfigured).not.toContain('接下来没有要截止的事项');

    const failed = await renderLive({ status: 'error', message: '订阅地址无法访问' });
    expect(failed).toMatch(/data-kind="error"[^>]*>\s*日历读取失败：订阅地址无法访问/);
  });

  it('keeps showing the rows under a notice when the data is stale', async () => {
    const html = await renderLive({ status: 'ok', data: ROWS, stale: true });

    expect(html).toContain('显示的是上次读到的日程');
    expect(items(html)).toHaveLength(2);
  });

  it('says the widget is unavailable when loading failed', async () => {
    const html = await renderLive(undefined);

    expect(html).toContain('Deadline 暂时不可用');
    expect(html).not.toContain('<li');
  });
});
