/**
 * 日历、今天、Deadline 三个 Widget 共用的「订阅数据 → 展示数据」外壳。
 * 只引用适配层的类型（标准化后的数据模型），浏览器端（Calendar.svelte）也能用；
 * 放在 lib 而不是 adapters 下，是因为浏览器端的代码不能引用适配层的模块（见 tests/architecture）
 */
import type { CalendarEvent, CalendarFeed } from '../adapters/calendar/model';

/** 正常时带上换算好的展示数据；未登录（没有日程可看）、订阅读取失败原样透传 */
export type FeedView<T> =
  | { readonly status: 'ok'; readonly data: T; readonly stale: boolean }
  | { readonly status: 'unconfigured' }
  | { readonly status: 'error'; readonly message: string };

export function mapFeed<T>(feed: CalendarFeed, toData: (events: readonly CalendarEvent[]) => T): FeedView<T> {
  if (feed.status !== 'ok') return feed;
  return { status: 'ok', data: toData(feed.events), stale: feed.stale };
}

export type FeedNotice =
  | { readonly kind: 'error'; readonly text: string }
  | { readonly kind: 'stale'; readonly text: string };

/** 列表上方的提示；正常且是最新数据时没有，没登录、没订阅也不提示 */
export function feedNotice(view: FeedView<unknown>): FeedNotice | undefined {
  switch (view.status) {
    case 'unconfigured':
      return undefined;
    case 'error':
      return { kind: 'error', text: `日历读取失败：${view.message}` };
    case 'ok':
      return view.stale ? { kind: 'stale', text: '日历暂时连不上，显示的是上次读到的日程' } : undefined;
  }
}
