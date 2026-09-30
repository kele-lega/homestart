import type { AppConfig } from './config';
import { ConfigError } from './config-error';
import { findWidget } from './layout';
import { describeError } from './log';
import type { WidgetDefinition } from './widget';

/**
 * 在 Widget 的 server island 里执行 load：页面先渲染骨架，不等外部接口；island 的响应回来后替换骨架。
 * 任何失败都返回 { ok: false } 而不是抛出——island 响应不是 200 时，浏览器会一直停在骨架上。
 */

export type WidgetData<D> = { readonly ok: true; readonly data: D } | { readonly ok: false };

export interface WidgetDataDeps {
  readonly loadConfig: () => Promise<AppConfig>;
  /** 反向代理注入的登录用户 */
  readonly user: string;
  readonly signal: AbortSignal;
  /** 服务端日志；页面上只显示“暂时不可用” */
  readonly logError: (message: string) => void;
}

const FAILED: WidgetData<never> = Object.freeze({ ok: false });

export async function loadWidgetData<O, D>(
  definition: WidgetDefinition<O, D>,
  id: string,
  deps: WidgetDataDeps,
): Promise<WidgetData<D>> {
  try {
    const config = await deps.loadConfig();
    const widget = findWidget(config.layout, id);
    // 页面渲染之后配置可能改过；无效配置已由页面显示在 Widget 的位置，这里不重复记录
    if (!widget || widget.type !== definition.type || widget.error) return FAILED;
    if (!definition.load) throw new Error(`${definition.type} 没有定义 load`);
    // 类型一致且没有 error，说明 options 已经过这个 definition 的 schema 校验
    const ctx = { user: deps.user, signal: deps.signal, site: config.site };
    const data = await definition.load(widget.options as O, ctx);
    return { ok: true, data };
  } catch (error) {
    // 配置错误已在页面渲染时记录；访客已经离开页面（请求被取消）也不是故障
    if (!(error instanceof ConfigError) && !deps.signal.aborted) deps.logError(`${id} 加载失败：${describeError(error)}`);
    return FAILED;
  }
}
