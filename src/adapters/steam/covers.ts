import { z } from 'astro/zod';
import { createCache } from '../../core/cache';
import { fetchJson, UpstreamError } from '../../core/http';

const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets';
const HOST = 'api.steampowered.com';
const StoreResponse = z.object({
  response: z.object({
    store_items: z.array(z.object({
      appid: z.number().int().positive(),
      success: z.number().int(),
      assets: z.object({
        asset_url_format: z.string(),
        library_capsule: z.string().optional(),
        header: z.string().optional(),
      }).optional(),
    })).optional(),
  }),
});

/** 新游戏的资源路径含哈希，不能按 appId 拼接；只在旧封面失败时查询，不需要 API Key。 */
export async function fetchSteamCover(appId: number, options: { readonly fetch?: typeof fetch } = {}): Promise<string> {
  const input = {
    ids: [{ appid: appId }],
    context: { language: 'schinese', country_code: 'CN' },
    data_request: { include_assets: true },
  };
  const url = `https://${HOST}/IStoreBrowseService/GetItems/v1/?${new URLSearchParams({ input_json: JSON.stringify(input) })}`;
  const data = await fetchJson(url, { timeoutMs: 4000, maxBytes: 64 * 1024, ...options });
  const parsed = StoreResponse.safeParse(data);
  if (!parsed.success) throw new UpstreamError(`${HOST} 返回的数据不合法（GetItems）`);
  const item = parsed.data.response.store_items?.find((item) => item.appid === appId && item.success === 1);
  const assets = item?.assets;
  if (assets) {
    // 只接受本游戏在官方 CDN 下的相对资源路径，不能让上游数据变成任意地址跳转。
    const format = new RegExp(`^steam/apps/${appId}/\\$\\{FILENAME\\}(?:\\?t=\\d+)?$`);
    if (!format.test(assets.asset_url_format)) throw new UpstreamError(`${HOST} 返回的封面路径不合法`);
    for (const file of [assets.library_capsule, assets.header]) {
      if (file && /^[a-zA-Z0-9_./-]+$/.test(file) && !file.split('/').includes('..') && !file.startsWith('/')) {
        return `${CDN}/${assets.asset_url_format.replace('${FILENAME}', file)}`;
      }
    }
  }
  // 没有商店资源的老游戏仍可尝试传统横版头图。
  return `${CDN}/steam/apps/${appId}/header.jpg`;
}

const covers = createCache<string>({ ttlMs: 24 * 3_600_000, maxEntries: 1000 });

/** 按游戏共享缓存，并发查询合并；失败不缓存，下次仍可重试。 */
export function resolveSteamCover(appId: number): Promise<string> {
  return covers.get(String(appId), () => fetchSteamCover(appId));
}
