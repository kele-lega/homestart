import { z } from 'astro/zod';
import { defineWidget } from '../../core/widget';

/**
 * 页头右边的三个圆：头像（悬停展开账号面板）、设置、公告。
 * 头像和面板按站内登录渲染（locals.auth），公告存在服务端（adapters/announcements），都不需要配置
 */
const ToolbarOptions = z.strictObject({});

export type ToolbarOptions = z.infer<typeof ToolbarOptions>;

export default defineWidget({
  type: 'toolbar',
  chrome: 'bare',
  options: ToolbarOptions,
});
