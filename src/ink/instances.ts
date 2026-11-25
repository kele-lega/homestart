import type { AppConfig } from '../core/config';
import type { ResolvedWidget } from '../core/layout';
import type { CalendarOptions } from '../widgets/calendar/widget';
import type { ClockOptions } from '../widgets/clock/widget';
import type { DeadlineOptions } from '../widgets/deadline/widget';
import type { FavoritesOptions } from '../widgets/favorites/widget';
import type { SearchOptions } from '../widgets/search/widget';
import type { ServerOptions } from '../widgets/server/widget';
import type { SteamOptions } from '../widgets/steam/widget';
import type { WeatherOptions } from '../widgets/weather/widget';

/**
 * 留白不按 layout.yaml 的区域排版（版面是固定的），只从里面取各类 Widget 的实例：
 * 每种类型取放进页面的第一个，用它的 id 调操作、跑 server island，用它的 options（已合并登录用户的偏好）渲染。
 * 某种类型没放进页面，或者配置有误时，留白里对应的那一块不出现。只在服务端用
 */

export interface Instance<O> {
  readonly id: string;
  readonly options: O;
}

export interface InkInstances {
  readonly clock?: Instance<ClockOptions>;
  readonly search?: Instance<SearchOptions>;
  readonly weather?: Instance<WeatherOptions>;
  readonly calendar?: Instance<CalendarOptions>;
  readonly deadline?: Instance<DeadlineOptions>;
  readonly favorites?: Instance<FavoritesOptions>;
  readonly steam?: Instance<SteamOptions>;
  readonly server?: Instance<ServerOptions>;
  /** 分类导航：留白里只用来判断要不要显示分类和目录，链接本身来自 config.links */
  readonly linkGroups?: Instance<unknown>;
}

const TYPES = {
  clock: 'clock',
  search: 'search',
  weather: 'weather',
  calendar: 'calendar',
  deadline: 'deadline',
  favorites: 'favorites',
  steam: 'steam',
  server: 'server',
  linkGroups: 'link-groups',
} as const satisfies Record<keyof InkInstances, string>;

function placed(config: AppConfig): ResolvedWidget[] {
  return config.layout.zones.flatMap((zone) => zone.items.flatMap((item) => (item.kind === 'card' ? item.widgets : [item])));
}

export function inkInstances(config: AppConfig): InkInstances {
  const widgets = placed(config).filter((widget) => !widget.error);
  const pick = (type: string) => {
    const widget = widgets.find((candidate) => candidate.type === type);
    return widget ? { id: widget.id, options: widget.options } : undefined;
  };
  return Object.fromEntries(
    Object.entries(TYPES).flatMap(([key, type]) => {
      const instance = pick(type);
      return instance ? [[key, instance]] : [];
    }),
  ) as InkInstances;
}
