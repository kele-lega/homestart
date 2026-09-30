import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../../core/api';
import { formatIssues } from '../../../core/config-error';
import { getAuthService } from '../../../adapters/auth/service';
import { AuthInputError } from '../../../adapters/auth/store';

/** 仅管理员：新建普通用户/管理员账号（GET 列出账号，POST 新建）。没有公开注册入口 */
const CreateBody = z.object({
  username: z.string({ error: '请填写用户名' }),
  password: z.string({ error: '请填写密码' }),
  role: z.enum(['admin', 'user'], { error: '角色必须是 admin 或 user' }),
});

function requireAdmin(locals: App.Locals): boolean {
  return locals.auth?.role === 'admin';
}

export const GET: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (!requireAdmin(locals)) return json(403, fail('只有管理员可以查看账号列表'));
  const service = await getAuthService();
  return json(200, ok(service.listUsers()));
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (!requireAdmin(locals)) return json(403, fail('只有管理员可以创建账号'));

  const read = await readJsonBody(request);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = CreateBody.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));

  const service = await getAuthService();
  try {
    await service.createUser(parsed.data.username, parsed.data.password, parsed.data.role);
    return json(200, ok(null));
  } catch (error) {
    if (error instanceof AuthInputError) return json(400, fail(error.message));
    throw error;
  }
};
