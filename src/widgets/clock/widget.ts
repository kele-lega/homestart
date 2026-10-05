import { z } from 'astro/zod';
import { definePreferences, defineWidget } from '../../core/widget';

/** 时钟：时间和旁边两行日期（公历 + 星期、农历 + 节日），时区取 site.yaml 的 timezone */
const ClockOptions = z.strictObject({
  /** 是否显示秒。默认不显示，页面更安静 */
  seconds: z.boolean().default(false),
  /** 时间旁那两行「2026.10.01 周四」「八月廿一 · 国庆」的四段，各自能关掉；一行全关时那一行不显示 */
  date: z.boolean().default(true),
  weekday: z.boolean().default(true),
  /** 农历日期，例如「八月廿一」 */
  lunar: z.boolean().default(true),
  /** 节日或节气，例如「国庆」「秋分」 */
  festival: z.boolean().default(true),
});

export type ClockOptions = z.infer<typeof ClockOptions>;

/**
 * 设置页的时钟一栏。不是 strictObject：以前存的偏好里还有问候语（greeting、name），读的时候丢掉，
 * 不让旧偏好整条作废、连带秒和日期的设置也退回默认
 */
const ClockPreference = z.object({
  seconds: z.boolean(),
  // 后加的几项：以前存的偏好里没有，读作显示
  date: z.boolean().default(true),
  weekday: z.boolean().default(true),
  lunar: z.boolean().default(true),
  festival: z.boolean().default(true),
});

export type ClockPreference = z.infer<typeof ClockPreference>;

export default defineWidget({
  type: 'clock',
  chrome: 'bare',
  options: ClockOptions,
  preferences: definePreferences({
    schema: ClockPreference,
    apply: (options: ClockOptions, preference) => ({ ...options, ...preference }),
  }),
});
