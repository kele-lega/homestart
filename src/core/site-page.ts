import { ConfigError } from './config-error';
import { loadConfig } from './runtime';
import { parseSite, type SiteConfig } from './site';

/**
 * 登录页、个人中心只要站点名和时区。配置文件写坏了首页会显示说明页，但这两页照样要能打开
 * （不然连登录去修都没法登录）：配置有误时退回 site.yaml 的默认值，并把错误交给调用方记日志
 */
export async function loadSiteOrDefault(onError: (message: string) => void): Promise<SiteConfig> {
  try {
    return (await loadConfig()).site;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    onError(error.message);
    return parseSite({});
  }
}
