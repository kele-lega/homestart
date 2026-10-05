import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { clientIp } from '../../../adapters/auth/http';
import { recordHit, siteCounts } from '../../../adapters/site-stats';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../../core/api';
import { createRateLimiter } from '../../../core/rate-limit';
import { HIT_KINDS } from '../../../lib/site-stats';

/**
 * 本站的导航、搜索次数。GET 所有人都能看（首页「本站」版块轮询），POST { kind } 加一并返回加完的计数。
 * 没登录的访客也算：登录了按账号、没登录按来源 IP 限流，超出的这一次不算（429），刷不上去
 */
const Body = z.object({ kind: z.enum(HIT_KINDS) });

// 正常人一分钟点不开几十个网站；e2e 全从本机来，用环境变量放宽（同 WIDGET_ACTION_RATE_LIMIT），不改变生产环境的默认值
const configuredLimit = Number(process.env.SITE_HIT_RATE_LIMIT);
const allowHit = createRateLimiter({
  limit: Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 60,
  windowMs: 60_000,
  maxKeys: 5000,
});

export const GET: APIRoute = async ({ request }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  return json(200, ok(await siteCounts()));
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  // 账号和 IP 加上不同的前缀，不会撞到一起
  const key = locals.auth ? `user:${locals.auth.username}` : `ip:${clientIp(request.headers) ?? 'direct'}`;
  if (!allowHit(key)) return json(429, fail('操作太频繁，请稍后再试'));
  const read = await readJsonBody(request);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = Body.safeParse(read.value);
  if (!parsed.success) return json(400, fail('不认识的计数'));
  return json(200, ok(await recordHit(parsed.data.kind)));
};
