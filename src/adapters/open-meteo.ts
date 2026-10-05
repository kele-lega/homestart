import { z } from 'astro/zod';
import { formatIssues } from '../core/config-error';
import { fetchJson, UpstreamError, type FetchJsonOptions } from '../core/http';

/**
 * Open-Meteo 天气预报（https://open-meteo.com，不需要 Key）。只负责请求和校验，
 * 返回与界面无关的 Forecast；天气代码对应的文字和图标由 weather Widget 决定。
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
// 实测约 1.4 秒；缓存为空时骨架屏最多等这么久
const LIMITS = { timeoutMs: 5000, maxBytes: 16 * 1024 } as const;

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Forecast {
  readonly temperature: number;
  /** WMO 天气代码 */
  readonly code: number;
  readonly isDay: boolean;
  /** 当前相对湿度（%）；模型没有这一项时为 undefined */
  readonly humidity: number | undefined;
  /** 当地“今天”的最高 / 最低气温和最大降水概率（%）；模型没有这一项时为 undefined */
  readonly high: number | undefined;
  readonly low: number | undefined;
  readonly rainChance: number | undefined;
}

// 每日数组里的元素可能是 null：模型在这个地点没有这一项
const Daily = z.array(z.number().nullable());

const ForecastResponse = z.object({
  current: z.object({
    temperature_2m: z.number(),
    // 湿度只是附带的一行小字：缺了或是 null 都不影响整份预报
    relative_humidity_2m: z.number().nullish(),
    weather_code: z.number().int().nonnegative(),
    is_day: z.union([z.literal(0), z.literal(1)]),
  }),
  daily: z.object({
    temperature_2m_max: Daily,
    temperature_2m_min: Daily,
    precipitation_probability_max: Daily,
  }),
});

function forecastUrl({ latitude, longitude }: GeoPoint): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    // 按坐标所在地的时区划分“今天”
    timezone: 'auto',
    forecast_days: '1',
  });
  return `${ENDPOINT}?${params}`;
}

export interface ForecastOptions {
  /** 测试时注入 */
  readonly fetch?: typeof fetch;
}

export async function fetchForecast(point: GeoPoint, options: ForecastOptions = {}): Promise<Forecast> {
  const fetchOptions: FetchJsonOptions = options.fetch ? { ...LIMITS, fetch: options.fetch } : LIMITS;
  const parsed = ForecastResponse.safeParse(await fetchJson(forecastUrl(point), fetchOptions));
  if (!parsed.success) {
    throw new UpstreamError(`api.open-meteo.com 返回的数据不合法：${formatIssues(parsed.error.issues).join('；')}`);
  }
  const { current, daily } = parsed.data;
  return {
    temperature: current.temperature_2m,
    code: current.weather_code,
    isDay: current.is_day === 1,
    humidity: current.relative_humidity_2m ?? undefined,
    high: daily.temperature_2m_max[0] ?? undefined,
    low: daily.temperature_2m_min[0] ?? undefined,
    rainChance: daily.precipitation_probability_max[0] ?? undefined,
  };
}
