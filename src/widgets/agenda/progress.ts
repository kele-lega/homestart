/**
 * “今天”列表里哪件已经过去、哪件是下一件（正在进行的也算）。服务端首屏和浏览器端每分钟刷新共用，
 * 所以这个模块不能引用服务端代码
 */

export interface Timing {
  /** UTC 毫秒 */
  readonly start: number;
  readonly end: number;
}

/** 已经结束；没有时长的日程到了开始时刻就算过去 */
export function isDone({ start, end }: Timing, now: number): boolean {
  return now >= Math.max(start, end);
}

/** 下一件在列表里的位置；全天日程（没有 timing）不参与。都过去了时为 -1 */
export function nextIndex(timings: readonly (Timing | undefined)[], now: number): number {
  return timings.findIndex((timing) => timing !== undefined && !isDone(timing, now));
}
