import { z } from 'astro/zod';
import { defineWidget } from '../../core/widget';

/** 占位 Widget：布局搭建阶段使用，也是编写新 Widget 的最小示例 */

export const options = z.strictObject({
  /** 骨架行数，用来模拟真实内容的高度 */
  lines: z.number().int().min(1).max(12).default(3),
  note: z.string().optional(),
});

export type PlaceholderOptions = z.infer<typeof options>;

export default defineWidget({ type: 'placeholder', options });
