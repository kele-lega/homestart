import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { clearCalendarUrl, saveCalendarUrl } from '../../../adapters/calendar/service';
import { settingsRoute } from '../../../core/settings-api';

/** PUT 保存 ICS 订阅地址、DELETE 删除；都只回传主机名（地址本身就是访问日历的凭据，不回显） */

// 地址的格式、长度、能否访问都由 saveCalendarUrl 检查
const Body = z.object({ url: z.string({ error: '缺少订阅地址' }) });

export const PUT: APIRoute = settingsRoute({ body: Body, run: ({ user, body }) => saveCalendarUrl(user, body.url) });

export const DELETE: APIRoute = settingsRoute({ run: ({ user }) => clearCalendarUrl(user) });
