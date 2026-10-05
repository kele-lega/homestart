import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { updatePreferences } from '../../../adapters/preferences';
import { settingsRoute } from '../../../core/settings-api';

/**
 * PATCH /api/settings/preferences：{ Widget 类型: 偏好 | null }，null 恢复默认。
 * 一次可以改几项，任何一项不合格整体不改；返回改完的那几项（恢复默认的是 null）
 */
const Body = z.record(z.string(), z.unknown(), { error: '设置的格式不对' });

export const PATCH: APIRoute = settingsRoute({
  body: Body,
  run: async ({ user, body }) => {
    const next = await updatePreferences(user, body);
    return Object.fromEntries(Object.keys(body).map((type) => [type, Object.hasOwn(next, type) ? next[type] : null]));
  },
});
