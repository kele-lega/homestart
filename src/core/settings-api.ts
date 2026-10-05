import type { APIContext } from 'astro';
import type { z } from 'astro/zod';
import { ANONYMOUS, fail, isCrossSite, json, ok, readJsonBody, userFrom } from './api';
import { formatIssues } from './config-error';
import { UpstreamError } from './http';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { ActionInputError } from './widget';

/**
 * 设置页的接口（/api/settings/*）共用的一套检查：跨站拦截 → 要有身份 → 限流 → 请求体校验 → 执行。
 * 身份和 Widget 操作一样取 userFrom：站内登录优先，没有时退回反代注入的用户名；匿名一律 401。
 * 输入错误（ActionInputError）400 并原样显示，外部服务出错 502，其它 500 只记日志
 */

// 设置是手动点保存的，正常人一分钟点不了几十次
const settingsLimit = createRateLimiter({ limit: 30, windowMs: 60_000, maxKeys: 1000 });

export interface SettingsRequest<B> {
  readonly user: string;
  readonly body: B;
  readonly context: APIContext;
}

export interface SettingsRoute<B> {
  /** 不声明就不读请求体 */
  readonly body?: z.ZodType<B>;
  /** 不跟设置共用额度的接口（比如记录网站点击）自带一个限流器 */
  readonly allow?: RateLimiter;
  /** 请求体上限，默认 MAX_BODY_BYTES（4 KB）；整份网站导航、上传的图标要大一些 */
  readonly maxBodyBytes?: number;
  readonly run: (request: SettingsRequest<B>) => Promise<unknown>;
}

export function settingsRoute<B = undefined>(route: SettingsRoute<B>): (context: APIContext) => Promise<Response> {
  const allow = route.allow ?? settingsLimit;
  return async (context) => {
    const { request, locals, logger } = context;
    if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
    const user = userFrom(request.headers, locals.auth);
    if (user === ANONYMOUS) return json(401, fail('请先登录'));
    if (!allow(user)) return json(429, fail('操作太频繁，请稍后再试'));

    let body = undefined as B;
    if (route.body) {
      const read = await readJsonBody(request, route.maxBodyBytes);
      if (!read.ok) return json(read.status, fail(read.message));
      const parsed = route.body.safeParse(read.value);
      if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));
      body = parsed.data;
    }

    try {
      return json(200, ok(await route.run({ user, body, context })));
    } catch (error) {
      if (error instanceof ActionInputError) return json(400, fail(error.message));
      logger.error(`${new URL(request.url).pathname} 失败：${error instanceof Error ? error.message : String(error)}`);
      return error instanceof UpstreamError
        ? json(502, fail('外部服务暂时不可用，请稍后再试'))
        : json(500, fail('服务器内部错误'));
    }
  };
}
