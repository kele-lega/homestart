import { z } from 'astro/zod';
import { defineWidget } from '../../core/widget';

/**
 * 分类导航：按 links.yaml 的 categories 分组显示全部链接。
 * 桌面端悬停预览、点击固定；手机端点按展开。分类和链接只在配置文件里编辑。
 */
export const options = z.strictObject({});

export type LinkGroupsOptions = z.infer<typeof options>;

export default defineWidget({ type: 'link-groups', chrome: 'bare', options });
