/**
 * Steam.svelte 的纯逻辑：读 recent 操作的响应。浏览器端代码，只引用类型
 */
import type { SteamView } from './data';

interface Envelope {
  readonly success?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
}

const asEnvelope = (body: unknown): Envelope => (typeof body === 'object' && body !== null ? body : {});

function isSteamView(data: unknown): data is SteamView {
  const value = data as Partial<Record<keyof SteamView, unknown>> | null;
  return typeof value === 'object' && value !== null && typeof value.sub === 'string' && typeof (value.feed as { status?: unknown } | undefined)?.status === 'string';
}

/** recent 操作的数据；失败或形状不对时 undefined */
export function readSteamView(body: unknown): SteamView | undefined {
  const { success, data } = asEnvelope(body);
  return success === true && isSteamView(data) ? data : undefined;
}
