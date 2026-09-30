import { z } from 'astro/zod';
import { defineWidget } from '../../core/widget';

/** 时钟：时间、日期（含农历）和问候语，时区取 site.yaml 的 timezone */
const ClockOptions = z.strictObject({
  /** 是否显示秒。默认不显示，页面更安静 */
  seconds: z.boolean().default(false),
  /** 是否显示“下午好”之类的问候语 */
  greeting: z.boolean().default(true),
  /** 问候语后面的称呼，例如“上午好，冲凉”；不填只显示问候语 */
  name: z.string().trim().min(1).optional(),
});

export type ClockOptions = z.infer<typeof ClockOptions>;

export default defineWidget({
  type: 'clock',
  chrome: 'bare',
  options: ClockOptions,
});
