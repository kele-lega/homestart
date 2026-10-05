import type { AppConfig } from './config';

// 配置对象只在文件变化后才会重新生成，按对象去重即可做到「每次加载只提示一次」
const reported = new WeakSet<AppConfig>();

export function reportWarningsOnce(config: AppConfig, warn: (message: string) => void): void {
  if (reported.has(config)) return;
  reported.add(config);
  config.layout.warnings.forEach((message) => warn(message));
}
