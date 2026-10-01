import { z } from 'astro/zod';
import { ConfigError, formatIssues } from './config-error';
import { Id, SITE_PATH, ToneSchema } from './schema-parts';

/** links.yaml：所有网站链接的唯一数据源，常用网站、分类链接和本地搜索都从这里取 */

const HTTPS_ASSET = /^https:\/\/[^\s"'<>()]+$/;
const HOST_PLACEHOLDER = '{host}';

const Name = z.string().trim().min(1, '名称不能为空');

/** 没填 icon 时按网址域名取图标；{host} 会被替换成域名，改这一行就能换图标服务 */
export const DEFAULT_FAVICON_SERVICE = 'https://a.favicon.im/{host}?larger=true';

const FaviconService = z
  .string()
  .trim()
  .refine((v) => HTTPS_ASSET.test(v) && v.includes(HOST_PLACEHOLDER), `图标服务需为 https 地址且包含 ${HOST_PLACEHOLDER} 占位符`);

const Icon = z
  .string()
  .refine((v) => SITE_PATH.test(v) || HTTPS_ASSET.test(v), '图标需为站内路径（如 /icons/github.svg）或 https 地址');

const LinkSchema = z.strictObject({
  name: Name,
  // 只允许 http(s)，避免 javascript: 之类的链接被渲染进 href；
  // 规范化后引号、尖括号等会被百分号编码，前端拼接时也不会出问题
  url: z.url({ protocol: /^https?$/, error: '网址必须以 http:// 或 https:// 开头' }).transform((v) => new URL(v).href),
  icon: Icon.optional(),
  /** 深色模式下换用的图标（例如黑色的 GitHub 标志在深色背景上看不清） */
  iconDark: Icon.optional(),
  description: z.string().trim().optional(),
  category: Id.optional(),
  /** 是否显示在「常用网站」 */
  favorite: z.boolean().default(false),
  /** 额外的搜索关键词（拼音、缩写等） */
  keywords: z.array(z.string()).default([]),
});

const CategorySchema = z.strictObject({
  id: Id,
  name: Name,
  /** 底部分类导航里这一组的色调，同 layout.yaml 的 tone */
  tone: ToneSchema.default('neutral'),
});

const LinksSchema = z.strictObject({
  /** 图标服务模板，含 {host} 占位符；不填用 DEFAULT_FAVICON_SERVICE */
  faviconService: FaviconService.default(DEFAULT_FAVICON_SERVICE),
  categories: z.array(CategorySchema).default([]),
  links: z.array(LinkSchema).default([]),
});

export type Link = z.infer<typeof LinkSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type LinksConfig = z.infer<typeof LinksSchema>;

/** 从网址域名推导图标地址；service 是含 {host} 的模板 */
export function deriveIcon(url: string, service: string): string {
  return service.replace(HOST_PLACEHOLDER, new URL(url).hostname);
}

export function parseLinks(raw: unknown): LinksConfig {
  const parsed = LinksSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new ConfigError('links.yaml', formatIssues(parsed.error.issues));

  const { categories, links, faviconService } = parsed.data;
  const ids = categories.map((c) => c.id);
  const problems = [
    ...ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `分类 "${id}" 重复`),
    ...links
      .filter((link) => link.category !== undefined && !ids.includes(link.category))
      .map((link) => `链接 "${link.name}" 的分类 "${link.category}" 不存在`),
  ];
  if (problems.length > 0) throw new ConfigError('links.yaml', problems);

  // 没填图标就按网址域名取 favicon，配置里只写 name/url 也能有图标
  return {
    ...parsed.data,
    links: links.map((link) => (link.icon ? link : { ...link, icon: deriveIcon(link.url, faviconService) })),
  };
}
