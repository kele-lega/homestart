import type { APIRoute } from 'astro';
import { resolveSteamCover } from '../../adapters/steam/covers';
import { UpstreamError } from '../../core/http';
import { logBackgroundError } from '../../core/log';

/** 只解析官方封面地址并跳转；图片本身仍由浏览器从 Steam CDN 加载。 */
export const GET: APIRoute = async ({ params }) => {
  const value = params.appId ?? '';
  const appId = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(appId) || appId > 0xffff_ffff) {
    return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  try {
    const cover = await resolveSteamCover(appId);
    return new Response(null, {
      status: 302,
      headers: { location: cover, 'cache-control': 'public, max-age=86400' },
    });
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
    logBackgroundError('steam', `${appId} 的封面地址读取失败`, error);
    // 接口暂时连不上时，仍尝试老游戏的横版头图；不缓存这次降级。
    return new Response(null, {
      status: 302,
      headers: {
        location: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        'cache-control': 'no-store',
      },
    });
  }
};
