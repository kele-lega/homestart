import type { AppConfig } from './config';
import type { ResolvedWidget } from './layout';
import type { Preferences } from './preferences';
import type { ClockOptions, ClockPreference } from '../widgets/clock/widget';
import type { DeadlineOptions, DeadlinePreference } from '../widgets/deadline/widget';
import type { SearchOptions, SearchPreference } from '../widgets/search/widget';
import type { SteamOptions, SteamPreference } from '../widgets/steam/widget';
import type { WeatherOptions, WeatherPreference } from '../widgets/weather/widget';
import type { EngineId } from '../widgets/search/engines';

/**
 * 设置页每一栏的数据：默认值（layout.yaml 里的）和用户存过的值。页面上放了哪种 Widget 才有哪一栏。
 * 只依赖类型，结果直接交给浏览器端的 SettingsSheet.svelte
 */
export interface Section<P> {
  /** layout.yaml 里同类型第一个实例的配置，换算成偏好的形状 */
  readonly defaults: P;
  /** 用户存过的；没存过（用的是默认值）时 undefined */
  readonly saved: P | undefined;
}

export interface PreferenceSections {
  readonly weather?: Section<WeatherPreference>;
  readonly search?: Section<SearchPreference> & {
    readonly engines: readonly EngineId[];
  };
  readonly clock?: Section<ClockPreference>;
  readonly deadline?: Section<DeadlinePreference>;
  readonly steam?: Section<SteamPreference>;
}

function firstOfType(config: AppConfig, type: string): ResolvedWidget | undefined {
  return config.layout.zones
    .flatMap((zone) => zone.items.flatMap((item) => (item.kind === 'card' ? item.widgets : [item])))
    .find((widget) => widget.type === type && !widget.error);
}

/** 页面上有这种 Widget 时，按它的配置算出默认值 */
function section<O, P>(config: AppConfig, preferences: Preferences, type: string, toPreference: (options: O) => P) {
  const widget = firstOfType(config, type);
  if (!widget) return undefined;
  const saved = Object.hasOwn(preferences, type) ? (preferences[type] as P) : undefined;
  return { defaults: toPreference(widget.options as O), saved };
}

/** 是否放了这几种 Widget 之一：日历订阅这一栏只要有任何一个读订阅的版块就出现 */
export function hasWidget(config: AppConfig, ...types: readonly string[]): boolean {
  return types.some((type) => firstOfType(config, type) !== undefined);
}

/** config 必须是没合并偏好的那份，默认值才是 layout.yaml 里的 */
export function preferenceSections(config: AppConfig, preferences: Preferences): PreferenceSections {
  const search = section(config, preferences, 'search', (options: SearchOptions) => ({
    engine: options.engines[0]!,
    suggest: options.suggest !== false,
    sites: options.sites,
  }));
  const searchOptions = firstOfType(config, 'search')?.options as SearchOptions | undefined;
  return {
    weather: section(config, preferences, 'weather', ({ label, latitude, longitude }: WeatherOptions) => ({
      label: label ?? '',
      latitude,
      longitude,
    })),
    search: search && searchOptions ? { ...search, engines: searchOptions.engines } : undefined,
    clock: section(config, preferences, 'clock', ({ seconds, date, weekday, lunar, festival }: ClockOptions) => ({
      seconds,
      date,
      weekday,
      lunar,
      festival,
    })),
    deadline: section(config, preferences, 'deadline', ({ max, days }: DeadlineOptions) => ({ max, days })),
    steam: section(config, preferences, 'steam', ({ count }: SteamOptions) => ({
      count,
    })),
  };
}
