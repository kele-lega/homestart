import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import { ConfigError } from '../../src/core/config-error';
import { resolveLayout, type ResolvedCard, type ResolvedWidget } from '../../src/core/layout';
import { defineWidget, type AnyWidgetDefinition } from '../../src/core/widget';

const registry = new Map<string, AnyWidgetDefinition>([
  ['note', defineWidget({ type: 'note', title: '便签', options: z.object({ text: z.string().default('hi') }) })],
  ['clock', defineWidget({ type: 'clock', chrome: 'bare', options: z.object({}) })],
]);

function fixture() {
  return {
    widgets: [
      { id: 'clock', type: 'clock' },
      { id: 'calendar', type: 'note', title: '日历' },
      { id: 'agenda', type: 'note' },
      { id: 'deadline', type: 'note', tone: 'pink', options: { text: 'ddl' } },
    ],
    zones: [
      { id: 'header', layout: 'areas', areas: ['clock'], columns: '1fr', mobile: 'block', items: ['clock'] },
      { id: 'side', items: [['calendar', 'agenda'], 'deadline'] },
    ],
    page: {
      desktop: { areas: ['header', 'side'], columns: '1fr' },
      mobile: { order: ['header', 'deadline', 'agenda'] },
    },
  };
}

function problemsOf(raw: unknown): readonly string[] {
  try {
    resolveLayout(raw, registry);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected resolveLayout to throw');
}

describe('resolveLayout', () => {
  it('resolves zones, cards and widgets with defaults applied', () => {
    const layout = resolveLayout(fixture(), registry);
    const [header, side] = layout.zones;

    expect(layout.page).toEqual({ areas: '"header" "side"', columns: '1fr', rows: undefined, dividers: 'none' });
    expect(header).toMatchObject({ id: 'header', layout: 'areas', areas: '"clock"', order: 0 });
    expect(header!.mobile).toEqual({ mode: 'block', areas: undefined, columns: undefined });
    expect(side).toMatchObject({ layout: 'stack', order: undefined, mobile: { mode: 'flatten' } });

    const card = side!.items[0] as ResolvedCard;
    expect(card.kind).toBe('card');
    expect(card.widgets.map((w) => [w.id, w.title, w.order])).toEqual([
      ['calendar', '日历', undefined],
      ['agenda', '便签', 2],
    ]);
    expect(side!.items[1]).toMatchObject({ id: 'deadline', tone: 'pink', order: 1, options: { text: 'ddl' } });
    expect((header!.items[0] as ResolvedWidget).chrome).toBe('bare');
    expect(card.widgets[0]!.options).toEqual({ text: 'hi' });
  });

  it('marks unknown widget types and bad options on the widget instead of failing the page', () => {
    const raw = fixture();
    raw.widgets[1] = { id: 'calendar', type: 'nope', title: '日历' };
    raw.widgets[3] = { id: 'deadline', type: 'note', tone: 'purple', options: { text: 42 } as never };
    const [, side] = resolveLayout(raw, registry).zones;
    const card = side!.items[0] as ResolvedCard;

    expect(card.widgets[0]!.error).toContain('nope');
    expect(card.widgets[0]!.error).toContain('clock、note');
    expect((side!.items[1] as ResolvedWidget).error).toContain('text');
  });

  it('warns about widgets that are not placed in any zone', () => {
    const raw = fixture();
    raw.widgets.push({ id: 'spare', type: 'note' });
    expect(resolveLayout(raw, registry).warnings).toEqual(['Widget "spare" 没有放进任何区域，不会显示']);
  });

  it('rejects malformed ids through the schema', () => {
    const raw = fixture();
    raw.widgets[0] = { id: 'Clock Widget', type: 'clock' };
    expect(problemsOf(raw)[0]).toMatch(/^widgets\.0\.id: /);
  });

  it('collects every cross-reference problem at once', () => {
    const raw = fixture();
    raw.widgets.push({ id: 'agenda', type: 'note' }, { id: 'side', type: 'note' });
    raw.zones[1]!.items = [['calendar', 'agenda'], 'deadline', 'deadline', 'ghost'];
    raw.page.mobile.order = ['header', 'calendar', 'side', 'header'];

    expect(problemsOf(raw)).toEqual([
      'id "agenda" 重复（Widget 与区域的 id 必须全局唯一）',
      'id "side" 重复（Widget 与区域的 id 必须全局唯一）',
      '区域 "side" 引用了不存在的 Widget "ghost"',
      'Widget "deadline" 被放进了多个位置',
      'mobile.order 里的 "side" 不能单独排序：它的 mobile 为 flatten，请改为排它里面的 Widget',
      'mobile.order 里的 "header" 重复',
    ]);
  });

  it('checks that grid areas match the zones and widgets they place', () => {
    const raw = fixture();
    raw.page.desktop.areas = ['header side', 'footer side'];
    raw.zones[0]!.areas = ['clock weather'];
    raw.zones[0]!.columns = '1fr; color: red';

    expect(problemsOf(raw)).toEqual([
      'page.desktop.areas 中的 "footer" 没有对应的区域',
      '区域 "header" 的 areas 中的 "weather" 没有对应的 Widget',
      '区域 "header" 的 columns 含有不允许的字符：1fr; color: red',
    ]);
  });

  it('requires areas when a zone uses the areas layout', () => {
    const raw = fixture();
    delete (raw.zones[0] as { areas?: string[] }).areas;
    expect(problemsOf(raw)).toEqual(['区域 "header" 使用 areas 布局时必须设置 areas']);
  });

  it('rejects areas on zones that do not use the areas layout, since they reach inline styles', () => {
    const raw = fixture();
    Object.assign(raw.zones[1]!, { areas: ['x"; background: url(https://evil.example/t.png); --y: "'] });
    expect(problemsOf(raw)).toEqual(['区域 "side" 的 areas / mobileAreas 只在 layout: areas 时有效']);
  });

  it('requires a title on zones that collapse on mobile', () => {
    const raw = fixture();
    Object.assign(raw.zones[1]!, { mobile: 'collapse' });
    raw.page.mobile.order = ['header', 'side'];
    expect(problemsOf(raw)).toEqual(['区域 "side" 在手机端可折叠，必须设置 title']);
  });

  it('reports malformed page areas, mobile areas, rows and unknown order ids together', () => {
    const raw = fixture();
    raw.page.desktop.areas = ['header side', 'side side side'];
    Object.assign(raw.page.desktop, { rows: 'auto; x: y' });
    Object.assign(raw.zones[0]!, { mobileAreas: ['ghost'] });
    raw.page.mobile.order = ['header', 'ghost'];

    expect(problemsOf(raw)).toEqual([
      'page.desktop.areas：areas 每行的列数必须相同："header side" "side side side"',
      'page.desktop.areas：区域 "side" 必须是矩形',
      'page.desktop.rows 含有不允许的字符：auto; x: y',
      '区域 "header" 的 mobileAreas 中的 "ghost" 没有对应的 Widget',
      '区域 "header" 的 mobileAreas 缺少 "clock"',
      'mobile.order 里的 "ghost" 不是可排序的区域或 Widget',
    ]);
  });

  it('rejects titles that are only whitespace', () => {
    const raw = fixture();
    raw.widgets[1] = { id: 'calendar', type: 'note', title: '   ' };
    expect(problemsOf(raw)[0]).toMatch(/^widgets\.1\.title: /);
  });

  it('normalizes whitespace inside area rows so the CSS string stays valid', () => {
    const raw = fixture();
    raw.page.desktop.areas = ['  header\n\t side '];
    expect(resolveLayout(raw, registry).page.areas).toBe('"header side"');
  });

  it('stretches zone items by default and accepts an explicit cross-axis alignment', () => {
    const raw = fixture();
    const header = { ...raw.zones[0]!, align: 'center' };
    const [resolvedHeader, side] = resolveLayout({ ...raw, zones: [header, raw.zones[1]!] }, registry).zones;

    expect(resolvedHeader!.align).toBe('center');
    expect(side!.align).toBe('stretch');
    expect(problemsOf({ ...raw, zones: [{ ...header, align: 'middle' }, raw.zones[1]!] })[0]).toMatch(/^zones\.0\.align: /);
  });

  it('draws no dividers or masthead unless asked, and rejects unknown divider modes', () => {
    const raw = fixture();
    const plain = resolveLayout(raw, registry);
    expect(plain.page.dividers).toBe('none');
    expect(plain.zones.map((zone) => [zone.dividers, zone.masthead])).toEqual([
      ['none', false],
      ['none', false],
    ]);

    const header = { ...raw.zones[0]!, dividers: 'both', masthead: true };
    const desktop = { ...raw.page.desktop, dividers: 'columns' };
    const ruled = resolveLayout({ ...raw, zones: [header, raw.zones[1]!], page: { ...raw.page, desktop } }, registry);
    expect(ruled.zones[0]).toMatchObject({ dividers: 'both', masthead: true });
    expect(ruled.page.dividers).toBe('columns');

    const dotted = { ...raw, zones: [{ ...header, dividers: 'dotted' }, raw.zones[1]!] };
    expect(problemsOf(dotted)[0]).toMatch(/^zones\.0\.dividers: /);
  });
});
