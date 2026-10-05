import type { APIContext } from 'astro';
import { fail, isCrossSite, json } from './api';
import { CAPTCHA_LENGTH, createCaptchaStore } from './captcha';
import { createRateLimiter } from './rate-limit';

/**
 * 建议接口（/api/suggestions、/api/suggestions/<id>、/api/suggestions/captcha）共用的检查：跨站拦截 → 站内登录（看、改、删要管理员）→ 限流。
 * 只认站内登录（locals.auth）：反代注入的用户名没有角色，也没有昵称
 */

// 提交是手写的，一分钟写不了几条；管理员的标记、删除是一条一条点的
const allowSubmit = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 1000 });
const allowManage = createRateLimiter({ limit: 60, windowMs: 60_000, maxKeys: 100 });
// 看不清点「换一张」、答错自动换，一分钟十几张足够；再多就是在刷题
const allowCaptcha = createRateLimiter({ limit: 15, windowMs: 60_000, maxKeys: 1000 });

/**
 * 提交建议前要过的图片验证码，进程内共用一份。
 * SUGGESTION_CAPTCHA_FIXED 只给 e2e 用：设成 4 位数字时每道题的答案都是它，生产环境绝不能设置
 */
const fixedCode = process.env.SUGGESTION_CAPTCHA_FIXED?.trim() ?? '';
export const suggestionCaptcha = createCaptchaStore(
  new RegExp(`^\\d{${CAPTCHA_LENGTH}}$`).test(fixedCode) ? { newCode: () => fixedCode } : {},
);

type Context = Pick<APIContext, 'request' | 'locals'>;

/** 通过时返回 undefined，否则是该直接回给浏览器的响应 */
export function rejectSuggestionSubmit({ request, locals }: Context): Response | undefined {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (!locals.auth) return json(401, fail('登录后才能提交建议'));
  if (!allowSubmit(locals.auth.username)) return json(429, fail('提交得太频繁了，请过一会儿再试'));
  return undefined;
}

export function rejectCaptchaIssue({ request, locals }: Context): Response | undefined {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (!locals.auth) return json(401, fail('登录后才能提交建议'));
  if (!allowCaptcha(locals.auth.username)) return json(429, fail('换得太频繁了，请过一会儿再试'));
  return undefined;
}

export function rejectSuggestionManage({ request, locals }: Context): Response | undefined {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (locals.auth?.role !== 'admin') return json(403, fail('只有管理员可以查看建议'));
  if (!allowManage(locals.auth.username)) return json(429, fail('操作太频繁，请稍后再试'));
  return undefined;
}

/** 写文件失败（文件读不懂、磁盘满）：只记日志，给浏览器一句笼统的话 */
export function suggestionStoreFailed(logger: APIContext['logger'], error: unknown): Response {
  logger.error(`建议写入失败：${error instanceof Error ? error.message : String(error)}`);
  return json(500, fail('没能保存，请稍后再试'));
}
