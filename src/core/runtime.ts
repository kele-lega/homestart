import { resolve } from 'node:path';
import { createConfigLoader } from './config';
import { registry } from './registry';

/**
 * 服务端运行时单例。CONFIG_DIR 必须在运行时读取：import.meta.env 会在构建时内联，
 * 那样 Docker 里就无法通过环境变量改配置目录。
 */
export const loadConfig = createConfigLoader(resolve(process.env.CONFIG_DIR ?? 'config'), registry);
