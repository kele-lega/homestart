/**
 * Calendar.svelte 的纯逻辑：读 month 操作的响应、方向键在格子间移动。浏览器端代码，只引用类型
 */
import type { MonthData } from './data';

interface Envelope {
  readonly success?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
}

const asEnvelope = (body: unknown): Envelope => (typeof body === 'object' && body !== null ? body : {});

/** 服务端是同源的，只核对形状，防的是代理或网关回了别的 JSON */
function isMonthData(data: unknown): data is MonthData {
  const value = data as Partial<Record<keyof MonthData, unknown>> | null;
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value.grid as { cells?: unknown } | undefined)?.cells) &&
    typeof (value.feed as { status?: unknown } | undefined)?.status === 'string'
  );
}

/** month 操作的数据；失败或形状不对时 undefined */
export function readMonth(body: unknown): MonthData | undefined {
  const { success, data } = asEnvelope(body);
  return success === true && isMonthData(data) ? data : undefined;
}

/** 可以留着再用的月份：订阅读取失败、用的是旧数据时不留，下次翻到（或重试）再问服务端 */
export function cacheable({ feed }: MonthData): boolean {
  return feed.status === 'unconfigured' || (feed.status === 'ok' && !feed.stale);
}

const WEEK = 7;

/**
 * 月历格子里的键盘移动：左右一天、上下一周，Home / End 到本周首尾。
 * 返回目标格子的下标；不是移动键或会移出格子时 undefined（翻页用上面的按钮或 PageUp / PageDown）
 */
export function moveInGrid(key: string, index: number, count: number): number | undefined {
  const column = index % WEEK;
  const targets: Readonly<Record<string, number>> = {
    ArrowLeft: index - 1,
    ArrowRight: index + 1,
    ArrowUp: index - WEEK,
    ArrowDown: index + WEEK,
    Home: index - column,
    End: index - column + WEEK - 1,
  };
  if (!Object.hasOwn(targets, key)) return undefined;
  const target = targets[key]!;
  return target >= 0 && target < count ? target : undefined;
}

/** PageUp / PageDown 翻到上个月 / 下个月 */
export function pageDelta(key: string): -1 | 1 | undefined {
  if (key === 'PageUp') return -1;
  if (key === 'PageDown') return 1;
  return undefined;
}
