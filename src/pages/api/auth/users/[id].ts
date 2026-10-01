import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../../../core/api';
import { formatIssues } from '../../../../core/config-error';
import { getAuthService } from '../../../../adapters/auth/service';
import { AuthInputError } from '../../../../adapters/auth/store';

/** 仅管理员：PUT 重置某用户的密码，DELETE 删除该账号（不能删除自己）。两种操作都会让这个账号已有的登录失效 */
const ResetBody = z.object({ password: z.string({ error: '请填写新密码' }) });

function requireAdmin(locals: App.Locals): boolean {
  return locals.auth?.role === 'admin';
}

function parseId(raw: string | undefined): number | undefined {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export const PUT: APIRoute = async ({ request, locals, params }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (!requireAdmin(locals)) return json(403, fail('只有管理员可以重置密码'));
  const id = parseId(params.id);
  if (id === undefined) return json(404, fail('没有这个账号'));

  const read = await readJsonBody(request);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = ResetBody.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));

  const service = await getAuthService();
  try {
    // 被重置的账号所有登录随之失效；重置的是自己时保留当前这台设备
    await service.resetPassword(id, parsed.data.password, locals.auth!);
    return json(200, ok(null));
  } catch (error) {
    if (error instanceof AuthInputError) return json(400, fail(error.message));
    throw error;
  }
};

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (!requireAdmin(locals)) return json(403, fail('只有管理员可以删除账号'));
  const id = parseId(params.id);
  if (id === undefined) return json(404, fail('没有这个账号'));

  const service = await getAuthService();
  try {
    service.deleteUser(id, locals.auth!.userId);
    return json(200, ok(null));
  } catch (error) {
    if (error instanceof AuthInputError) return json(400, fail(error.message));
    throw error;
  }
};
