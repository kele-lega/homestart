import type { AstroGlobal } from 'astro';
import { loadConfigFor } from '../adapters/preferences';
import { userFrom } from '../core/api';
import type { AppConfig } from '../core/config';
import { ConfigError } from '../core/config-error';
import { reportWarningsOnce } from '../core/warnings';

export type PageConfig = { readonly config: AppConfig; readonly error?: undefined } | { readonly config?: undefined; readonly error: ConfigError };

/**
 * 留白五个地址的页面共用：读合并了偏好的配置（岛屿和 Widget 操作用的是同一份），配置有误时显示说明页而不是空白 500。
 * 页面按登录状态和个人偏好渲染（管理员的入口只出现在管理员的页面里）：只许浏览器自己留、每次都回来确认，代理不能缓存
 */
export async function loadPage(astro: AstroGlobal): Promise<PageConfig> {
  astro.response.headers.set('cache-control', 'private, no-cache');
  const result = await loadConfigFor(userFrom(astro.request.headers, astro.locals.auth)).then(
    (config): PageConfig => ({ config }),
    (error: unknown): PageConfig => {
      if (error instanceof ConfigError) return { error };
      throw error;
    },
  );
  if (result.config) {
    reportWarningsOnce(result.config, (message) => astro.logger.warn(message));
  } else {
    astro.logger.error(result.error.message);
    astro.response.status = 500;
  }
  return result;
}
