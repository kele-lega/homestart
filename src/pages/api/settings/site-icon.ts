import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { fetchSiteIcon } from '../../../adapters/site-icons/fetch';
import { IconInputError, MAX_ICON_BYTES, saveIcon } from '../../../adapters/site-icons/store';
import { createRateLimiter } from '../../../core/rate-limit';
import { settingsRoute } from '../../../core/settings-api';
import { ActionInputError } from '../../../core/widget';

/**
 * POST /api/settings/site-icon：给导航里的一个网站弄图标，返回 { icon: '/site-icons/<文件名>' }。
 *   { url }：自动抓这个网站的图标（抓不到 502，提示可以自己上传）
 *   { image }：上传的图片，base64（可以带 data:image/...;base64, 前缀）
 * 图标存在本站，之后显示时不连外网。只是生成一个地址，真正用上要再保存导航
 */
const Body = z.union([
  z.strictObject({ url: z.url({ protocol: /^https?$/, error: '网址必须以 http:// 或 https:// 开头' }).max(2048) }),
  z.strictObject({ image: z.string().max(Math.ceil((MAX_ICON_BYTES * 4) / 3) + 256) }),
]);

// base64 比原图大三分之一，再留一点 JSON 的余量
const MAX_ICON_BODY = Math.ceil((MAX_ICON_BYTES * 4) / 3) + 1024;
// 抓图标要连外站，比普通设置慢、也更容易被滥用：单独限流
const allow = createRateLimiter({ limit: 30, windowMs: 60_000, maxKeys: 1000 });

const DATA_URL_PREFIX = /^data:[\w/+.-]*;base64,/;

function decodeImage(image: string): Uint8Array {
  const base64 = image.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ActionInputError('上传的图片格式不对');
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

export const POST: APIRoute = settingsRoute({
  body: Body,
  allow,
  maxBodyBytes: MAX_ICON_BODY,
  run: async ({ body, context }) => {
    const bytes = 'url' in body ? await fetchSiteIcon(body.url, { signal: context.request.signal }) : decodeImage(body.image);
    try {
      return { icon: await saveIcon(bytes) };
    } catch (error) {
      if (error instanceof IconInputError) throw new ActionInputError(error.message);
      throw error;
    }
  },
});
