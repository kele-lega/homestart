import { z } from 'astro/zod';
import { defineWidget } from '../../core/widget';

/**
 * 分类导航：按分类分组显示全部链接。登录用户在设置页「导航」里编辑自己的分类和网站，没编辑过的用 links.yaml。
 * 桌面端悬停预览、点击固定；手机端点按展开。
 */
export const options = z.strictObject({});

export type LinkGroupsOptions = z.infer<typeof options>;

export default defineWidget({ type: 'link-groups', chrome: 'bare', options });
