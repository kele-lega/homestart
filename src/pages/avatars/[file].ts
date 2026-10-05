import type { APIRoute } from 'astro';
import { AVATAR_MIME, getAvatarFiles } from '../../adapters/avatars';

/**
 * GET /avatars/<哈希>.<扩展名>：用户自己上传的头像（adapters/avatars）。
 * 文件名由账号和内容决定，内容永远不变，可以长期缓存；换头像就是换了个文件名
 */
export const GET: APIRoute = async ({ params }) => {
  const avatar = await getAvatarFiles().read(params.file ?? '');
  if (!avatar) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      'content-type': AVATAR_MIME[avatar.type],
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
};
