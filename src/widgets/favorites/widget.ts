import { z } from 'astro/zod';
import { defineWidget } from '../../core/widget';

/**
 * 常用网站：links.yaml 里 favorite: true 的链接，按配置顺序显示成启动器图块。
 * 只在配置文件里编辑，页面上没有编辑 / 添加入口。
 */

export const options = z.strictObject({});

export type FavoritesOptions = z.infer<typeof options>;

// 栏目头右边要写「N 个」，所以栏目头由 View 自己画
export default defineWidget({ type: 'favorites', head: 'view', options });
