import { z } from 'astro/zod';
import { defineWidget } from '../../core/widget';

/**
 * 本站 / 服务器：正面「本站」所有人都看得到——一个翻页计数器（导航和搜索合在一起算），登录用户提建议，管理员再多一排工具（查看建议、发布公告）。
 * 管理员能翻到背面「服务器」：三个圆环是本机的 CPU、内存、存储，悬停看详细读数；下面一排是自己部署的服务入口。
 * 服务器那一面只进管理员的页面（接口 /api/server/stats 也按登录角色把关）
 */
export const SERVER_MAX_ENTRIES = 4;

const Entry = z.strictObject({
  /** 方框里的字，例如 terminal；只给管理员看 */
  name: z.string().trim().min(1).max(16),
  url: z.url({ protocol: /^https?$/, error: '网址必须以 http:// 或 https:// 开头' }),
  /** 悬停说明的第一行；域名总会写在下面 */
  description: z.string().trim().min(1).max(60).optional(),
});

const ServerOptions = z.strictObject({
  entries: z.array(Entry).max(SERVER_MAX_ENTRIES).default([]),
});

export type ServerEntry = z.infer<typeof Entry>;
export type ServerOptions = z.infer<typeof ServerOptions>;

export default defineWidget({
  type: 'server',
  title: '本站',
  head: 'view',
  options: ServerOptions,
});
