import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { checkSync, connectSync, disconnectSync, prepareSync } from '../../../adapters/calendar/google-sync';
import { settingsRoute } from '../../../core/settings-api';
import { loadSiteOrDefault } from '../../../core/site-page';

/**
 * 把自己添加的日程写进自己的 Google 日历（每个用户各自部署的 Apps Script）：
 * POST 生成口令、返回要复制的脚本；PUT 保存部署好的地址（先试连一次）；PATCH 再试连一次并补推（更新脚本以后）；DELETE 断开。
 * 脚本地址和口令只存在服务端，返回值里只有连没连上、还有几件没推过去
 */

const Body = z.object({ url: z.string({ error: '缺少脚本地址' }).max(2048) });

export const POST: APIRoute = settingsRoute({ run: ({ user }) => prepareSync(user) });

export const PUT: APIRoute = settingsRoute({
  body: Body,
  run: async ({ user, body, context }) => {
    // 定时日程按站点时区换算成真实时刻
    const site = await loadSiteOrDefault((message) => context.logger.error(message));
    return connectSync(user, body.url, site.timezone);
  },
});

export const PATCH: APIRoute = settingsRoute({
  run: async ({ user, context }) => {
    const site = await loadSiteOrDefault((message) => context.logger.error(message));
    return checkSync(user, site.timezone);
  },
});

export const DELETE: APIRoute = settingsRoute({ run: ({ user }) => disconnectSync(user) });
