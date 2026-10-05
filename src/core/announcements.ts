import { z } from 'astro/zod';
import { ANNOUNCEMENT_LIMITS, type Announcement } from '../lib/announcements';

/** 公告的校验（纯逻辑）：发布时的输入，以及从文件里读回来的每一条 */

const { title: TITLE_MAX, body: BODY_MAX, count: MAX_COUNT } = ANNOUNCEMENT_LIMITS;

// 换行统一成 \n，首尾空白去掉；正文中间的空行照留
const text = (max: number, label: string) =>
  z
    .string({ error: `请填写${label}` })
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().max(max, `${label}最多 ${max} 个字`));

export const AnnouncementInput = z.object({
  title: text(TITLE_MAX, '标题').pipe(z.string().min(1, '请填写标题')),
  body: text(BODY_MAX, '正文'),
});

export type AnnouncementInput = z.infer<typeof AnnouncementInput>;

/** id 由服务端生成（UUID），接口路径里只认这个形状 */
export const ANNOUNCEMENT_ID = /^[0-9a-f-]{36}$/;

const Stored = z.object({
  id: z.string().regex(ANNOUNCEMENT_ID),
  title: z.string().min(1).max(TITLE_MAX),
  body: z.string().max(BODY_MAX),
  createdAt: z.number().int().nonnegative(),
  author: z.string().max(64),
});

/** 文件里的列表：读不懂的条目跳过，新的在前，最多 MAX_COUNT 条 */
export function parseAnnouncements(raw: unknown): readonly Announcement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => {
      const parsed = Stored.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_COUNT);
}

/** 新的一条放最前面，超出上限的旧条目挤掉 */
export function withAnnouncement(list: readonly Announcement[], item: Announcement): readonly Announcement[] {
  return [item, ...list.filter((existing) => existing.id !== item.id)].slice(0, MAX_COUNT);
}
