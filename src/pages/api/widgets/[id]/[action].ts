import type { APIRoute } from 'astro';
import { runWidgetAction } from '../../../../core/actions';
import { fail, fetchSiteLabel, isCrossSite, json, readJsonBody, userFrom } from '../../../../core/api';
import { ConfigError } from '../../../../core/config-error';
import { createRateLimiter } from '../../../../core/rate-limit';
import { registry } from '../../../../core/registry';
import { loadConfigFor } from '../../../../adapters/preferences';
import { CLIENT_HEADER } from '../../../../lib/widget-api';

/**
 * Widget 操作接口，例如 GET /api/widgets/search/suggest?q=... 、PUT /api/widgets/<日历 id>/settings 。
 * 逻辑在 core/actions.ts；每个操作自己声明接受的方法，其他方法返回 405
 */

// 联想按键防抖后一般每秒 2~3 次，每分钟 120 次足够正常输入，又能挡住失控的循环请求。
// e2e 用同一个匿名用户 key 连续跑几十个用例，都会算进同一个窗口，用环境变量单独放宽
const configuredLimit = Number(process.env.WIDGET_ACTION_RATE_LIMIT);
const RATE_LIMIT = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 120;
const allow = createRateLimiter({ limit: RATE_LIMIT, windowMs: 60_000, maxKeys: 1000 });

// 被拒绝的请求按 Sec-Fetch-Site 各记一次：反向代理吞掉请求头导致全部 403 时有据可查，
// 又不会被反复刷屏。标签只有有限的几种，集合不会无限增长
const reportedRejections = new Set<string>();

function reportRejection(headers: Headers, warn: (message: string) => void): void {
  const site = fetchSiteLabel(headers);
  if (reportedRejections.has(site)) return;
  reportedRejections.add(site);
  const reason = site === '(missing)' ? `没有 Sec-Fetch-Site，${CLIENT_HEADER} 头也缺失或不正确` : `Sec-Fetch-Site: ${site}`;
  warn(`已拒绝跨站请求（${reason}），同类请求不再重复记录`);
}

// 所有方法走同一套检查：跨站拦截、限流、404/405 都在这里和 runWidgetAction 里统一处理
const handle: APIRoute = async ({ params, request, url, logger, locals }) => {
  if (isCrossSite(request.headers)) {
    reportRejection(request.headers, (message) => logger.warn(message));
    return json(403, fail('不允许跨站请求'));
  }

  const user = userFrom(request.headers, locals.auth);
  // 合并了个人偏好的配置：Steam 列几款、联想开没开，都和页面上看到的一致
  const config = await loadConfigFor(user).catch((error: unknown) => {
    // 配置错误已在页面渲染时记录，这里只告诉前端暂不可用
    if (error instanceof ConfigError) return undefined;
    throw error;
  });
  if (!config) return json(503, fail('配置有误，暂时无法使用'));

  const result = await runWidgetAction(
    {
      widgetId: params.id ?? '',
      action: params.action ?? '',
      method: request.method,
      params: url.searchParams,
      user,
      signal: request.signal,
      readBody: () => readJsonBody(request),
    },
    { config, registry, allow, logError: (message) => logger.error(message) },
  );
  return json(result.status, result.body, result.maxAge, result.headers);
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
