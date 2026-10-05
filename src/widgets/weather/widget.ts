import { z } from 'astro/zod';
import { fetchForecast, type Forecast } from '../../adapters/open-meteo';
import { createCache } from '../../core/cache';
import { logBackgroundError } from '../../core/log';
import { definePreferences, defineWidget } from '../../core/widget';

/** 页头天气：当前气温和天气、今天的最高 / 最低气温，另附湿度和降水概率 */
const WeatherOptions = z.strictObject({
  /** 显示在气温上方的地名，例如“坪山”；不填则不显示 */
  label: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type WeatherOptions = z.infer<typeof WeatherOptions>;

/** 设置页里搜出来的地点：地名连同坐标整体替换配置里的那一份 */
const WeatherPreference = z.strictObject({
  label: z.string().trim().min(1, '请填写地名').max(40, '地名最多 40 个字'),
  latitude: z.number().min(-90, '纬度在 -90 到 90 之间').max(90, '纬度在 -90 到 90 之间'),
  longitude: z.number().min(-180, '经度在 -180 到 180 之间').max(180, '经度在 -180 到 180 之间'),
});

export type WeatherPreference = z.infer<typeof WeatherPreference>;

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
  preferences: definePreferences({
    schema: WeatherPreference,
    apply: (options: WeatherOptions, place) => ({ ...options, ...place }),
  }),
  // 共享的请求不跟着某一个页面请求取消，超时由 fetchForecast 自己负责
  load: async ({ latitude, longitude }: WeatherOptions) =>
    forecasts.get(`${latitude},${longitude}`, async () => Object.freeze(await fetchForecast({ latitude, longitude }))),
});
