import type { Forecast } from '../../adapters/open-meteo';

/** 把预报整理成页头上的几行文字（纯函数） */

// WMO 天气代码，见 https://open-meteo.com/en/docs 末尾的 “WMO Weather interpretation codes”
const CONDITIONS: Readonly<Record<number, string>> = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '冻雾',
  51: '毛毛雨',
  53: '毛毛雨',
  55: '毛毛雨',
  56: '冻毛毛雨',
  57: '冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹',
  99: '雷阵雨伴冰雹',
};

const UNKNOWN = '天气未知';

export interface WeatherView {
  readonly temperature: string;
  readonly condition: string;
  readonly range: { readonly high: string; readonly low: string } | undefined;
  /** 湿度和降水概率：预报里有就显示，概率再低也照写 */
  readonly humidity: string | undefined;
  readonly rainChance: string | undefined;
}

function degrees(value: number): string {
  return `${Math.round(value)}°`;
}

function percent(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${Math.round(value)}%`;
}

export function present(forecast: Forecast): WeatherView {
  const { high, low } = forecast;
  return {
    temperature: degrees(forecast.temperature),
    condition: CONDITIONS[forecast.code] ?? UNKNOWN,
    range: high === undefined || low === undefined ? undefined : { high: degrees(high), low: degrees(low) },
    humidity: percent(forecast.humidity),
    rainChance: percent(forecast.rainChance),
  };
}
