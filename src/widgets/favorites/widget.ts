import { z } from 'astro/zod';
import { defineWidget } from '../../core/widget';

/**
 * 常用网站：登录用户最近点开过的几个网站（首页、分类导航、搜索结果里点的都算），最近的在前；
 * 点得不够多、或者没登录时，用 links.yaml 里 favorite: true 的链接按配置顺序补齐。
 * 点击记录按账号存在服务端（adapters/link-visits），页面上没有编辑 / 添加入口。
 */

export const options = z.strictObject({
  /** 显示几个；一排四格，默认正好一排 */
  count: z.number().int().min(1).max(12).default(4),
});

export type FavoritesOptions = z.infer<typeof options>;

// 栏目头右边要写说明，所以栏目头由 View 自己画
export default defineWidget({ type: 'favorites', head: 'view', options });
