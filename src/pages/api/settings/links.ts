import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { writeUserLinks } from '../../../adapters/user-links';
import { settingsRoute } from '../../../core/settings-api';
import { describeUserLinksIssue, UserLinksSchema } from '../../../core/user-links';
import { ActionInputError } from '../../../core/widget';

/**
 * PUT 保存账号自己的网站导航（整份替换），返回整理过的那份；DELETE 恢复成站点的 links.yaml。
 * 校验在这里自己做：出错时说清楚是第几个分类、第几个网站
 */

// 6 个分类 × 24 个网站，每条带上名称、网址、图标地址，64 KB 绰绰有余
const MAX_LINKS_BODY = 64 * 1024;

export const PUT: APIRoute = settingsRoute({
  body: z.unknown(),
  maxBodyBytes: MAX_LINKS_BODY,
  run: async ({ user, body }) => {
    const parsed = UserLinksSchema.safeParse(body);
    if (!parsed.success) throw new ActionInputError(describeUserLinksIssue(body, parsed.error.issues[0]!));
    await writeUserLinks(user, parsed.data);
    return parsed.data;
  },
});

export const DELETE: APIRoute = settingsRoute({
  run: async ({ user }) => {
    await writeUserLinks(user, undefined);
    return null;
  },
});
