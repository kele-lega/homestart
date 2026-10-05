import type { APIRoute } from 'astro';
import { listAnnouncements, publishAnnouncement } from '../../adapters/announcements';
import { AnnouncementInput } from '../../core/announcements';
import { announcementStoreFailed, rejectAnnouncementWrite } from '../../core/announcements-api';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../core/api';
import { formatIssues } from '../../core/config-error';

/**
 * 公告：GET 所有人都能看（首页弹窗打开时取一次最新的），POST 只有站内登录的管理员能发布，返回发布后的整个列表。
 * 删除见 ./announcements/[id].ts
 */

// 一条公告最多 60 字标题 + 2000 字正文，按 UTF-8 一个汉字 3 字节，再留点余量
const MAX_BODY_BYTES = 8192;

export const GET: APIRoute = async ({ request }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  return json(200, ok(await listAnnouncements()));
};

export const POST: APIRoute = async (context) => {
  const rejected = rejectAnnouncementWrite(context, '发布');
  if (rejected) return rejected;
  const read = await readJsonBody(context.request, MAX_BODY_BYTES);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = AnnouncementInput.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));

  const auth = context.locals.auth!;
  try {
    return json(200, ok(await publishAnnouncement(parsed.data, auth.displayName ?? auth.username)));
  } catch (error) {
    return announcementStoreFailed(context.logger, error);
  }
};
