import type { APIRoute } from 'astro';
import { removeAnnouncement } from '../../../adapters/announcements';
import { ANNOUNCEMENT_ID } from '../../../core/announcements';
import { announcementStoreFailed, rejectAnnouncementWrite } from '../../../core/announcements-api';
import { fail, json, ok } from '../../../core/api';

/** DELETE：管理员删掉一条公告。已经不在了也算删掉，返回删除后的整个列表 */
export const DELETE: APIRoute = async (context) => {
  const rejected = rejectAnnouncementWrite(context, '删除');
  if (rejected) return rejected;
  const id = context.params.id ?? '';
  if (!ANNOUNCEMENT_ID.test(id)) return json(404, fail('没有这条公告'));
  try {
    return json(200, ok(await removeAnnouncement(id)));
  } catch (error) {
    return announcementStoreFailed(context.logger, error);
  }
};
