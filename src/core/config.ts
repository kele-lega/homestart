import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { deepFreeze } from '../lib/deep-freeze';
import { ConfigError } from './config-error';
import { resolveLayout, type Registry, type ResolvedLayout } from './layout';
import { parseLinks, type LinksConfig } from './links';
import { parseSite, type SiteConfig } from './site';

/**
 * 读取 config/ 下的 YAML。每次调用只 stat 文件，内容没变就复用上次的解析结果，
 * 因此修改配置后刷新页面即可生效，不需要重新构建。
 */

export interface AppConfig {
  readonly site: SiteConfig;
  readonly links: LinksConfig;
  readonly layout: ResolvedLayout;
}

const FILES = ['site.yaml', 'links.yaml', 'layout.yaml'] as const;
type FileName = (typeof FILES)[number];

async function readYaml(dir: string, file: FileName, required: boolean): Promise<unknown> {
  const path = join(dir, file);
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw new ConfigError(file, [`无法读取 ${path}：${error.code ?? error.message}`]);
  });
  if (text === null) {
    if (required) throw new ConfigError(file, [`找不到文件 ${path}`]);
    return null;
  }
  try {
    return parse(text);
  } catch (error) {
    throw new ConfigError(file, [`YAML 语法错误：${(error as Error).message}`]);
  }
}

/** 修改时间 + 大小，任一文件变化即重新解析 */
async function stampOf(dir: string): Promise<string> {
  const parts = await Promise.all(
    FILES.map((file) =>
      stat(join(dir, file)).then(
        (s) => `${s.mtimeMs}:${s.size}`,
        () => 'missing',
      ),
    ),
  );
  return parts.join('|');
}

export function createConfigLoader(dir: string, registry: Registry): () => Promise<AppConfig> {
  let cached: { readonly stamp: string; readonly config: AppConfig } | undefined;

  return async function loadConfig() {
    const stamp = await stampOf(dir);
    if (cached?.stamp === stamp) return cached.config;

    const [site, links, layout] = await Promise.all([
      readYaml(dir, 'site.yaml', false),
      readYaml(dir, 'links.yaml', false),
      readYaml(dir, 'layout.yaml', true),
    ]);
    // 所有请求共用同一份结果，冻结后误改会直接报错，而不是影响下一个请求
    const config: AppConfig = deepFreeze({
      site: parseSite(site),
      links: parseLinks(links),
      layout: resolveLayout(layout, registry),
    });
    cached = { stamp, config };
    return config;
  };
}
