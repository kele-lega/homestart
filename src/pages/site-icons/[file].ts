import type { APIRoute } from 'astro';
import { ICON_MIME, readIcon } from '../../adapters/site-icons/store';

/**
 * GET /site-icons/<哈希>.<扩展名>：设置页「导航」里抓取或上传的网站图标（adapters/site-icons/store）。
 * 文件名由内容决定，内容永远不变，可以长期缓存。SVG 可能带脚本：CSP 禁掉一切，直接打开也执行不了；
 * 当作 <img> 显示时浏览器本来就不跑里面的脚本
 */
export const GET: APIRoute = async ({ params }) => {
  const icon = await readIcon(params.file ?? '');
  if (!icon) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(new Uint8Array(icon.bytes), {
    headers: {
      'content-type': ICON_MIME[icon.type],
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
};
