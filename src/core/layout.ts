import { ConfigError, formatIssues } from './config-error';
import { checkGrids, checkIds, checkOrder, checkPlacement } from './layout-checks';
import {
  LayoutSchema,
  type Dividers,
  type LayoutConfig,
  type MobileMode,
  type Tone,
  type WidgetInstanceConfig,
  type ZoneConfig,
  type ZoneLayout,
} from './layout-schema';
import type { AnyWidgetDefinition, Chrome, WidgetHead } from './widget';

export type Registry = ReadonlyMap<string, AnyWidgetDefinition>;

export interface ResolvedWidget {
  readonly kind: 'widget';
  readonly id: string;
  readonly type: string;
  readonly title: string | undefined;
  readonly tone: Tone;
  readonly chrome: Chrome;
  /** 栏目头由外框还是 View 画；类型未注册时总是外框 */
  readonly head: WidgetHead;
  readonly options: unknown;
  /** 手机端排序（仅 flatten 区域里的 Widget 有） */
  readonly order: number | undefined;
  /** 类型未注册或配置不合法时的说明；页面照常渲染，只有这个 Widget 显示错误 */
  readonly error: string | undefined;
}

export interface ResolvedCard {
  readonly kind: 'card';
  readonly id: string;
  readonly widgets: readonly ResolvedWidget[];
}

export interface ResolvedZone {
  readonly id: string;
  readonly title: string | undefined;
  readonly layout: ZoneLayout;
  readonly areas: string | undefined;
  readonly columns: string | undefined;
  readonly mobile: { readonly mode: MobileMode; readonly areas: string | undefined; readonly columns: string | undefined };
  /** 窄窗口（手机和宽屏之间）的摆法；没设的一项沿用宽屏 */
  readonly narrow: { readonly areas: string | undefined; readonly columns: string | undefined };
  readonly align: ZoneConfig['align'];
  readonly dividers: Dividers;
  readonly masthead: boolean;
  readonly order: number | undefined;
  readonly items: readonly (ResolvedWidget | ResolvedCard)[];
}

export interface ResolvedLayout {
  readonly page: {
    readonly areas: string;
    readonly columns: string;
    readonly rows: string | undefined;
    readonly dividers: Dividers;
  };
  readonly zones: readonly ResolvedZone[];
  readonly warnings: readonly string[];
}

/** ["a b", "c d"] → "a b" "c d"，可直接用作 grid-template-areas。行内空白统一成单个空格，换行会让 CSS 字符串失效 */
function toAreas(rows: readonly string[] | undefined): string | undefined {
  return rows?.map((row) => `"${row.trim().split(/\s+/).join(' ')}"`).join(' ');
}

function resolveWidget(instance: WidgetInstanceConfig, registry: Registry, order: number | undefined): ResolvedWidget {
  const definition = registry.get(instance.type);
  const base = { kind: 'widget', id: instance.id, type: instance.type, tone: instance.tone ?? 'neutral', order } as const;
  if (!definition) {
    const known = [...registry.keys()].sort().join('、');
    const error = `未知的 Widget 类型 "${instance.type}"（可用：${known || '无'}）`;
    return { ...base, title: instance.title, chrome: 'card', head: 'frame', options: undefined, error };
  }
  const parsed = definition.options.safeParse(instance.options ?? {});
  return {
    ...base,
    title: instance.title ?? definition.title,
    chrome: definition.chrome ?? 'card',
    head: definition.head ?? 'frame',
    options: parsed.success ? parsed.data : undefined,
    error: parsed.success ? undefined : `配置有误：${formatIssues(parsed.error.issues).join('；')}`,
  };
}

function buildZone(zone: ZoneConfig, config: LayoutConfig, registry: Registry): ResolvedZone {
  const orderOf = (id: string) => {
    const index = config.page.mobile.order.indexOf(id);
    return index === -1 ? undefined : index;
  };
  const instances = new Map(config.widgets.map((w) => [w.id, w]));
  const widget = (id: string) =>
    resolveWidget(instances.get(id)!, registry, zone.mobile === 'flatten' ? orderOf(id) : undefined);

  return {
    id: zone.id,
    title: zone.title,
    layout: zone.layout,
    areas: toAreas(zone.areas),
    columns: zone.columns,
    mobile: { mode: zone.mobile, areas: toAreas(zone.mobileAreas), columns: zone.mobileColumns },
    narrow: { areas: toAreas(zone.narrowAreas), columns: zone.narrowColumns },
    align: zone.align,
    dividers: zone.dividers,
    masthead: zone.masthead,
    order: zone.mobile === 'flatten' ? undefined : orderOf(zone.id),
    items: zone.items.map((item) =>
      Array.isArray(item) ? { kind: 'card' as const, id: item[0]!, widgets: item.map(widget) } : widget(item),
    ),
  };
}

/** 按实例 id 查找已放进页面的 Widget；没放进任何区域的实例不算 */
export function findWidget(layout: ResolvedLayout, id: string): ResolvedWidget | undefined {
  return layout.zones
    .flatMap((zone) => zone.items.flatMap((item) => (item.kind === 'card' ? item.widgets : [item])))
    .find((widget) => widget.id === id);
}

export function resolveLayout(raw: unknown, registry: Registry): ResolvedLayout {
  const parsed = LayoutSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError('layout.yaml', formatIssues(parsed.error.issues));
  const config = parsed.data;

  const problems = [...checkIds(config), ...checkPlacement(config), ...checkGrids(config), ...checkOrder(config)];
  if (problems.length > 0) throw new ConfigError('layout.yaml', problems);

  const placed = new Set(config.zones.flatMap((z) => z.items.flat()));
  const { desktop } = config.page;
  return {
    page: { areas: toAreas(desktop.areas)!, columns: desktop.columns, rows: desktop.rows, dividers: desktop.dividers },
    zones: config.zones.map((zone) => buildZone(zone, config, registry)),
    warnings: config.widgets
      .filter((w) => !placed.has(w.id))
      .map((w) => `Widget "${w.id}" 没有放进任何区域，不会显示`),
  };
}
