import { z } from 'astro/zod';
import { ConfigError, formatIssues } from './config-error';
import { SITE_PATH } from './schema-parts';

/** site.yaml：站点级设置 */

const SitePath = z.string().regex(SITE_PATH, '需为站内路径，例如 /images/bg.png');

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const SiteSchema = z.strictObject({
  title: z.string().min(1).default('Home'),
  description: z.string().optional(),
  favicon: SitePath.default('/favicon.ico'),
  lang: z.string().min(2).default('zh-CN'),
  timezone: z.string().refine(isTimeZone, '无效的时区，例如 Asia/Shanghai').default('Asia/Shanghai'),
  /** 页面背景图，不设置则使用纯色背景 */
  background: SitePath.optional(),
});

export type SiteConfig = z.infer<typeof SiteSchema>;

export function parseSite(raw: unknown): SiteConfig {
  const parsed = SiteSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new ConfigError('site.yaml', formatIssues(parsed.error.issues));
  return parsed.data;
}
