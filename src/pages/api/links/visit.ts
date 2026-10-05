import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { recordVisit } from '../../../adapters/link-visits';
import { loadConfigFor } from '../../../adapters/preferences';
import { createRateLimiter } from '../../../core/rate-limit';
import { settingsRoute } from '../../../core/settings-api';

/**
 * POST /api/links/visit { url }：记下登录用户点开了 links.yaml 里的哪个网站，常用网站按它排。
 * 只收这个账号能看到的网址（自己的导航，没存过就是 links.yaml），别的一律忽略，记录文件里不会混进任意内容。匿名 401（页面上本来就不会发）
 */
const Body = z.object({ url: z.string().max(2048) });

// 正常人一分钟点不开几十个网站；单独计数，不占设置页保存的额度
const allow = createRateLimiter({ limit: 60, windowMs: 60_000, maxKeys: 1000 });

export const POST: APIRoute = settingsRoute({
  body: Body,
  allow,
  run: async ({ user, body }) => {
    const { links } = await loadConfigFor(user);
    const known = links.links.some((link) => link.url === body.url);
    if (known) await recordVisit(user, body.url);
    return { recorded: known };
  },
});
