import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fail, isCrossSite, json, ok, readJsonBody } from '../../../core/api';
import { formatIssues } from '../../../core/config-error';
import { allowAccountWrite, rejectInput } from '../../../adapters/auth/http';
import { getAuthService } from '../../../adapters/auth/service';
import { AvatarInputError, getAvatarFiles, MAX_AVATAR_BYTES } from '../../../adapters/avatars';

/**
 * 自己的头像。默认是注册时随机定下的色块图，不能挑，只能换成自己上传的图或换回默认：
 *   PUT { image }：上传的图片，base64（可以带 data:image/...;base64, 前缀），浏览器已经裁好、缩好（lib/avatar-image）
 *   DELETE：换回默认色块图
 * 都返回 { avatar }（AvatarView）。换下来的旧图片随即删掉
 */
const Body = z.strictObject({
  image: z.string({ error: '请选择一张图片' }).max(Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 256, '图片太大'),
});

// base64 比原图大三分之一，再留一点 JSON 的余量
const MAX_AVATAR_BODY = Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 1024;
const DATA_URL_PREFIX = /^data:[\w/+.-]*;base64,/;

function decodeImage(image: string): Uint8Array | undefined {
  const base64 = image.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return undefined;
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function guard(request: Request, locals: App.Locals): Response | number {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  const auth = locals.auth;
  if (!auth) return json(401, fail('请先登录'));
  if (!allowAccountWrite(String(auth.userId))) return json(429, fail('操作太频繁，请稍后再试'));
  return auth.userId;
}

/** 换好头像后返回给页面的样子；账号这时已经不在了就当 404 */
async function avatarResponse(userId: number): Promise<Response> {
  const account = (await getAuthService()).account(userId);
  if (!account) return json(404, fail('没有这个账号'));
  return json(200, ok({ avatar: account.avatar }));
}

/** 旧文件和新文件同名（同一个人又传了同一张图）时不能删 */
async function release(previous: string | null, current: string | null): Promise<void> {
  if (previous && previous !== current) await getAvatarFiles().remove(previous);
}

export const PUT: APIRoute = async ({ request, locals }) => {
  const userId = guard(request, locals);
  if (userId instanceof Response) return userId;

  const read = await readJsonBody(request, MAX_AVATAR_BODY);
  if (!read.ok) return json(read.status, fail(read.message));
  const parsed = Body.safeParse(read.value);
  if (!parsed.success) return json(400, fail(formatIssues(parsed.error.issues).join('；')));
  const bytes = decodeImage(parsed.data.image);
  if (!bytes) return json(400, fail('上传的图片格式不对'));

  let file: string;
  try {
    file = await getAvatarFiles().save(userId, bytes);
  } catch (error) {
    if (error instanceof AvatarInputError) return json(400, fail(error.message));
    throw error;
  }
  const service = await getAuthService();
  let previous: string | null;
  try {
    previous = service.setAvatar(userId, file);
  } catch (error) {
    await getAvatarFiles().remove(file);
    return rejectInput(error);
  }
  await release(previous, file);
  return avatarResponse(userId);
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const userId = guard(request, locals);
  if (userId instanceof Response) return userId;

  const service = await getAuthService();
  let previous: string | null;
  try {
    previous = service.setAvatar(userId, null);
  } catch (error) {
    return rejectInput(error);
  }
  await release(previous, null);
  return avatarResponse(userId);
};
