/**
 * 主题偏好：system 跟随系统，light / dark 固定。
 * 偏好存在 localStorage，首屏由 BaseLayout 的内联脚本在绘制前应用，交互在 client/theme.ts。
 */

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'home:theme';

export function parseTheme(value: unknown): Theme {
  return THEMES.find((theme) => theme === value) ?? 'system';
}

/** 方向键在选项间循环移动，delta 为 1 或 -1 */
export function stepTheme(current: Theme, delta: 1 | -1): Theme {
  const index = THEMES.indexOf(current);
  return THEMES[(index + delta + THEMES.length) % THEMES.length]!;
}
