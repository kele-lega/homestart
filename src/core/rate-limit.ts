/** 固定窗口限流，按 key（登录用户）计数。单实例部署，计数放在内存里即可 */

export interface RateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
  /** 最多跟踪的 key 数，超出时丢弃最久没有请求的 key */
  readonly maxKeys: number;
  /** 单调时钟，系统时间回拨不影响窗口长度；测试时注入 */
  readonly now?: () => number;
}

/** 返回 true 表示放行并计数一次 */
export type RateLimiter = (key: string) => boolean;

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { limit, windowMs, maxKeys, now = () => performance.now() } = options;
  const windows = new Map<string, { readonly start: number; readonly count: number }>();

  return (key) => {
    const time = now();
    const current = windows.get(key);
    const window = current && time - current.start < windowMs ? current : { start: time, count: 0 };
    const allowed = window.count < limit;
    // 被拒绝也算一次访问并移到末尾：否则正在被限流的 key 最先被淘汰，换个身份刷请求就能重置额度
    windows.delete(key);
    windows.set(key, allowed ? { start: window.start, count: window.count + 1 } : window);
    if (windows.size > maxKeys) windows.delete(windows.keys().next().value!);
    return allowed;
  };
}
