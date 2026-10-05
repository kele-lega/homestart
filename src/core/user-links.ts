import { z } from 'astro/zod';
import type { Link, LinksConfig } from './links';
import { ToneSchema, type Tone } from './schema-parts';

/**
 * 每个账号自己的网站导航：几个分类，每个分类下若干网站。在设置页的「导航」一栏编辑，
 * 存进来之后这个账号的分类导航、搜索里的网站、常用网站都读它，不再读 links.yaml。
 * 这里只有纯逻辑（校验、和 LinksConfig 互相换算）；存在哪里见 adapters/user-links
 */

export const USER_LINKS_LIMITS = { categories: 6, links: 24, categoryName: 12, linkName: 30 } as const;

/** 抓取或上传后存在本站的图标：/site-icons/<内容的哈希>.<扩展名>，由 pages/site-icons/[file].ts 提供 */
export const SITE_ICON_PATH = /^\/site-icons\/[0-9a-f]{32}\.(?:png|jpg|gif|webp|ico|svg)$/;
// 从 links.yaml 复制过来的站内图标（public/icons/ 下）
const BUNDLED_ICON_PATH = /^\/icons\/(?!.*\.\.)[\w\-./]+$/;
const HTTPS_ICON = /^https:\/\/[^\s"'<>()]+$/;

/** 只收本站存的、自带的图标和 https 图片；不收任意站内路径（图片请求会带着登录 Cookie） */
const Icon = z
  .string()
  .max(2048)
  .refine((value) => SITE_ICON_PATH.test(value) || BUNDLED_ICON_PATH.test(value) || HTTPS_ICON.test(value), '图标地址不对');

const UserLink = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, '网站名称不能为空')
    .max(USER_LINKS_LIMITS.linkName, `网站名称最多 ${USER_LINKS_LIMITS.linkName} 个字`),
  // 只允许 http(s)，规范化后再存，和 links.yaml 一致
  url: z
    .url({ protocol: /^https?$/, error: '网址必须以 http:// 或 https:// 开头' })
    .max(2048, '网址太长')
    .transform((value) => new URL(value).href),
  /** 不填就显示首字母 */
  icon: Icon.optional(),
  // 下面几项设置页不编辑：从 links.yaml 复制过来的原样带着，搜索、常用网站照常用
  iconDark: Icon.optional(),
  description: z.string().trim().max(200).optional(),
  keywords: z.array(z.string().trim().max(40)).max(10).optional(),
  favorite: z.boolean().optional(),
});

const UserCategory = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, '分类名称不能为空')
    .max(USER_LINKS_LIMITS.categoryName, `分类名称最多 ${USER_LINKS_LIMITS.categoryName} 个字`),
  links: z.array(UserLink).max(USER_LINKS_LIMITS.links, `每个分类最多 ${USER_LINKS_LIMITS.links} 个网站`),
});

export const UserLinksSchema = z
  .strictObject({
    categories: z.array(UserCategory).max(USER_LINKS_LIMITS.categories, `最多 ${USER_LINKS_LIMITS.categories} 个分类`),
  })
  .refine(({ categories }) => new Set(categories.map((category) => category.name)).size === categories.length, '分类名称不能重复');

export type UserLinks = z.infer<typeof UserLinksSchema>;
export type UserLink = UserLinks['categories'][number]['links'][number];

/** 校验失败时给人看的一句话：「第 2 个分类「工具」的第 3 个网站：网址必须以 http:// 或 https:// 开头」 */
export function describeUserLinksIssue(input: unknown, issue: { readonly path: readonly PropertyKey[]; readonly message: string }): string {
  const [, categoryIndex, , linkIndex] = issue.path;
  if (typeof categoryIndex !== 'number') return issue.message;
  const categories = (input as { categories?: { name?: unknown }[] } | undefined)?.categories;
  const name = categories?.[categoryIndex]?.name;
  const where = `第 ${categoryIndex + 1} 个分类${typeof name === 'string' && name.trim() ? `「${name.trim()}」` : ''}`;
  return typeof linkIndex === 'number' ? `${where}的第 ${linkIndex + 1} 个网站：${issue.message}` : `${where}：${issue.message}`;
}

/** 存下来的条目读不懂（比如上限后来调小了）时读作没设置，退回 links.yaml */
export function parseUserLinks(value: unknown): UserLinks | undefined {
  const parsed = UserLinksSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** links.yaml 里没有、或者分类太多的颜色按顺序轮着用；neutral 留给没有颜色的场合 */
const CATEGORY_TONES: readonly Tone[] = ToneSchema.options.filter((tone) => tone !== 'neutral');

/**
 * 换算成 LinksConfig，交给分类导航、搜索、常用网站。分类的颜色沿用 links.yaml 里同名分类的，
 * 没有同名的按顺序取一个；分类 id 按位置生成
 */
export function toLinksConfig(user: UserLinks, defaults: LinksConfig): LinksConfig {
  const toneOf = new Map(defaults.categories.map((category) => [category.name, category.tone]));
  const categories = user.categories.map((category, index) => ({
    id: `c${index + 1}`,
    name: category.name,
    tone: toneOf.get(category.name) ?? CATEGORY_TONES[index % CATEGORY_TONES.length]!,
  }));
  const links: Link[] = user.categories.flatMap((category, index) =>
    category.links.map((link) => ({
      ...link,
      category: categories[index]!.id,
      favorite: link.favorite ?? false,
      keywords: link.keywords ?? [],
    })),
  );
  return { ...defaults, categories, links };
}

/**
 * 设置页「导航」一栏的起点：links.yaml 换算成同样的形状。没填分类的链接放不进来（它们只参与搜索），
 * 超出上限的分类和网站截掉
 */
export function fromLinksConfig({ categories, links }: LinksConfig): UserLinks {
  return {
    categories: categories.slice(0, USER_LINKS_LIMITS.categories).map((category) => ({
      name: category.name.slice(0, USER_LINKS_LIMITS.categoryName),
      links: links
        .filter((link) => link.category === category.id)
        .slice(0, USER_LINKS_LIMITS.links)
        .map(({ name, url, icon, iconDark, description, keywords, favorite }) => ({
          name: name.slice(0, USER_LINKS_LIMITS.linkName),
          url,
          ...(icon && { icon }),
          ...(iconDark && { iconDark }),
          ...(description && { description }),
          ...(keywords.length > 0 && { keywords }),
          ...(favorite && { favorite }),
        })),
    })),
  };
}
