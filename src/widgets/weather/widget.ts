import { z } from 'astro/zod';
import { fetchForecast, type Forecast } from '../../adapters/open-meteo';
import { createCache } from '../../core/cache';
import { logBackgroundError } from '../../core/log';
import { defineWidget } from '../../core/widget';

/** 页头天气：当前气温和天气、今天的最高 / 最低气温，另附湿度和降水概率 */
const WeatherOptions = z.strictObject({
  /** 显示在气温上方的地名，例如“坪山”；不填则不显示 */
  label: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type WeatherOptions = z.infer<typeof WeatherOptions>;

// Open-Meteo 每 15 分钟更新一次。天气是公开数据，按坐标全站共享一份缓存；
// 过期后一小时内先返回上一份预报、后台刷新，上游偶尔超时也不会让页头变成“不可用”
const forecasts = createCache<Forecast>({
  ttlMs: 10 * 60_000,
  maxEntries: 20,
  stale: { ms: 60 * 60_000, onError: (key, error) => logBackgroundError('weather', `${key} 后台刷新失败`, error) },
});

export default defineWidget({
  type: 'weather',
  chrome: 'bare',
  options: WeatherOptions,
  // 共享的请求不跟着某一个页面请求取消，超时由 fetchForecast 自己负责
  load: async ({ latitude, longitude }: WeatherOptions) =>
    forecasts.get(`${latitude},${longitude}`, async () => Object.freeze(await fetchForecast({ latitude, longitude }))),
});
