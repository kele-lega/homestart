import { isSafeTrackList, parseAreas } from './grid-areas';
import { itemAreaName, type LayoutConfig, type ZoneConfig } from './layout-schema';

/**
 * layout.yaml 的跨字段检查。每个函数只返回问题列表，不抛异常，
 * 由 resolveLayout 汇总后一次性报告。
 */

export function checkIds(config: LayoutConfig): string[] {
  const ids = [...config.widgets.map((w) => w.id), ...config.zones.map((z) => z.id)];
  return ids
    .filter((id, index) => ids.indexOf(id) !== index)
    .map((id) => `id "${id}" 重复（Widget 与区域的 id 必须全局唯一）`);
}

export function checkPlacement(config: LayoutConfig): string[] {
  const known = new Set(config.widgets.map((w) => w.id));
  const placed = config.zones.flatMap((zone) => zone.items.flat().map((id) => ({ zone: zone.id, id })));
  const ids = placed.map((p) => p.id);
  const repeated = new Set(ids.filter((id, index) => ids.indexOf(id) !== index));
  return [
    ...placed.filter((p) => !known.has(p.id)).map((p) => `区域 "${p.zone}" 引用了不存在的 Widget "${p.id}"`),
    ...[...repeated].filter((id) => known.has(id)).map((id) => `Widget "${id}" 被放进了多个位置`),
  ];
}

/** 比对 areas 里出现的名字与应当出现的名字 */
function checkAreaNames(rows: readonly string[], expected: readonly string[], label: string, noun: string): string[] {
  const { names, problems } = parseAreas(rows);
  return [
    ...problems.map((p) => `${label}：${p}`),
    ...names.filter((n) => !expected.includes(n)).map((n) => `${label} 中的 "${n}" 没有对应的${noun}`),
    ...expected.filter((n) => !names.includes(n)).map((n) => `${label} 缺少 "${n}"`),
  ];
}

function checkTracks(value: string | undefined, label: string): string[] {
  return value === undefined || isSafeTrackList(value) ? [] : [`${label} 含有不允许的字符：${value}`];
}

function checkZoneGrid(zone: ZoneConfig): string[] {
  const label = `区域 "${zone.id}" 的`;
  const names = zone.items.map(itemAreaName);
  const needsAreas = zone.layout === 'areas' && !zone.areas;
  // areas 的值会写进内联样式，非 areas 布局也不能放任不查，直接判为配置错误
  const strayAreas = zone.layout !== 'areas' && (zone.areas || zone.mobileAreas || zone.narrowAreas);
  const areaSets = [
    ['areas', zone.areas],
    ['narrowAreas', zone.narrowAreas],
    ['mobileAreas', zone.mobileAreas],
  ] as const;
  return [
    ...(needsAreas ? [`区域 "${zone.id}" 使用 areas 布局时必须设置 areas`] : []),
    ...(strayAreas ? [`区域 "${zone.id}" 的 areas / narrowAreas / mobileAreas 只在 layout: areas 时有效`] : []),
    ...(zone.mobile === 'collapse' && !zone.title ? [`区域 "${zone.id}" 在手机端可折叠，必须设置 title`] : []),
    ...(zone.layout === 'areas'
      ? areaSets.flatMap(([key, rows]) => (rows ? checkAreaNames(rows, names, `${label} ${key}`, ' Widget') : []))
      : []),
    ...checkTracks(zone.columns, `${label} columns`),
    ...checkTracks(zone.narrowColumns, `${label} narrowColumns`),
    ...checkTracks(zone.mobileColumns, `${label} mobileColumns`),
  ];
}

export function checkGrids(config: LayoutConfig): string[] {
  const { desktop } = config.page;
  const zoneIds = config.zones.map((z) => z.id);
  return [
    ...checkAreaNames(desktop.areas, zoneIds, 'page.desktop.areas', '区域'),
    ...checkTracks(desktop.columns, 'page.desktop.columns'),
    ...checkTracks(desktop.rows, 'page.desktop.rows'),
    ...config.zones.flatMap(checkZoneGrid),
  ];
}

/** 手机端可以单独排序的 id：非 flatten 区域本身，以及 flatten 区域里的 Widget */
export function orderableIds(config: LayoutConfig): Set<string> {
  return new Set(config.zones.flatMap((z) => (z.mobile === 'flatten' ? z.items.flat() : [z.id])));
}

export function checkOrder(config: LayoutConfig): string[] {
  const { order } = config.page.mobile;
  const orderable = orderableIds(config);
  const flattened = new Set(config.zones.filter((z) => z.mobile === 'flatten').map((z) => z.id));
  return order.flatMap((id, index) => {
    if (order.indexOf(id) !== index) return [`mobile.order 里的 "${id}" 重复`];
    if (flattened.has(id)) {
      return [`mobile.order 里的 "${id}" 不能单独排序：它的 mobile 为 flatten，请改为排它里面的 Widget`];
    }
    return orderable.has(id) ? [] : [`mobile.order 里的 "${id}" 不是可排序的区域或 Widget`];
  });
}
