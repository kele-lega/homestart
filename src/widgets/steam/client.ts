/**
 * Steam.svelte 的纯逻辑：读操作接口的响应。浏览器端代码，只引用类型
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

export type BindingResult =
  | { readonly ok: true; readonly steamId: string | undefined }
  | { readonly ok: false; readonly message: string };

const FALLBACK_ERROR = '保存失败，请稍后再试';

/** bind / unbind 的结果；失败时带上服务端给的说明。steamId 为空时序列化后没有这个键（JSON 会丢掉 undefined） */
export function readBinding(body: unknown): BindingResult {
  const { success, data, error } = asEnvelope(body);
  if (success === true && typeof data === 'object' && data !== null) {
    const steamId = (data as { steamId?: unknown }).steamId;
    return { ok: true, steamId: typeof steamId === 'string' ? steamId : undefined };
  }
  return { ok: false, message: typeof error === 'string' && error ? error : FALLBACK_ERROR };
}
