import type { APIContext } from 'astro';
import { fail, isCrossSite, json } from './api';
import { createRateLimiter } from './rate-limit';

/**
 * 公告接口（/api/announcements、/api/announcements/<id>）写操作共用的检查：跨站拦截 → 站内登录的管理员 → 限流。
 * 只认站内登录（locals.auth）：反代注入的用户名没有角色，谁都不是管理员
 */

// 发布是手动点的，正常人一分钟发不了几十条
const allowWrite = createRateLimiter({ limit: 30, windowMs: 60_000, maxKeys: 100 });

/** 通过时返回 undefined，否则是该直接回给浏览器的响应 */
export function rejectAnnouncementWrite(
  { request, locals }: Pick<APIContext, 'request' | 'locals'>,
  action: string,
): Response | undefined {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (locals.auth?.role !== 'admin') return json(403, fail(`只有管理员可以${action}公告`));
  if (!allowWrite(locals.auth.username)) return json(429, fail('操作太频繁，请稍后再试'));
  return undefined;
}

/** 写文件失败（文件读不懂、磁盘满）：只记日志，给浏览器一句笼统的话 */
export function announcementStoreFailed(logger: APIContext['logger'], error: unknown): Response {
  logger.error(`公告写入失败：${error instanceof Error ? error.message : String(error)}`);
  return json(500, fail('没能保存公告，请稍后再试'));
}
