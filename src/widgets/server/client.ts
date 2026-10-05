/**
 * Server.svelte 的纯逻辑：读 /api/server/stats 的响应。浏览器端代码，只引用类型
 */
import type { Gauge, ServerView } from './present';

/** 服务器状态接口；只有管理员能读，别人一律 403 */
export const STATS_URL = '/api/server/stats';

interface Envelope {
  readonly success?: unknown;
  readonly data?: unknown;
}

const asEnvelope = (body: unknown): Envelope => (typeof body === 'object' && body !== null ? body : {});

function isGauge(value: unknown): value is Gauge {
  const gauge = value as Partial<Record<keyof Gauge, unknown>> | null;
  return (
    typeof gauge === 'object' &&
    gauge !== null &&
    typeof gauge.label === 'string' &&
    typeof gauge.percent === 'number' &&
    typeof gauge.summary === 'string' &&
    Array.isArray(gauge.details)
  );
}

function isServerView(data: unknown): data is ServerView {
  const view = data as Partial<Record<keyof ServerView, unknown>> | null;
  return (
    typeof view === 'object' &&
    view !== null &&
    typeof view.uptime === 'string' &&
    Array.isArray(view.gauges) &&
    view.gauges.length === 3 &&
    view.gauges.every(isGauge)
  );
}

/** 接口的数据；失败或形状不对时 undefined */
export function readServerView(body: unknown): ServerView | undefined {
  const { success, data } = asEnvelope(body);
  return success === true && isServerView(data) ? data : undefined;
}
