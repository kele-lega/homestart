/**
 * 进程内缓存：新鲜期（TTL）+ 陈旧期（先返回旧值、后台刷新）+ 并发请求合并 + LRU 上限。
 * 只缓存成功结果；前台加载失败直接抛给调用方，不缓存，下次请求会重新加载。
 */

/** 陈旧期：新鲜期过后的这段时间先返回旧值并在后台刷新，刷新失败就继续用旧值 */
export interface StaleOptions {
  readonly ms: number;
  /** 后台刷新的错误没有调用方可以接住，必须在这里记录 */
  readonly onError: (key: string, error: unknown) => void;
}

export interface CacheOptions {
  /** 新鲜期：期内直接返回缓存 */
  readonly ttlMs: number;
  readonly maxEntries: number;
  /** 不传则没有陈旧期，过期后前台重新加载 */
  readonly stale?: StaleOptions | undefined;
  /** 单调时钟，系统时间回拨不会让条目一直新鲜；测试时注入 */
  readonly now?: () => number;
}

export interface Cache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
}

interface Entry<T> {
  readonly value: T;
  readonly storedAt: number;
}

export function createCache<T>(options: CacheOptions): Cache<T> {
  const { ttlMs, maxEntries, stale, now = () => performance.now() } = options;
  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  // Map 按插入顺序迭代：重新插入即移到末尾，超出上限时删除最早的
  function remember(key: string, entry: Entry<T>): void {
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
  }

  function refresh(key: string, load: () => Promise<T>): Promise<T> {
    const pending = inflight.get(key);
    if (pending) return pending;
    // 经 Promise.resolve 调用，load 同步抛错也会变成 rejection
    const promise = Promise.resolve()
      .then(load)
      .then((value) => {
        remember(key, { value, storedAt: now() });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return {
    async get(key, load) {
      const entry = entries.get(key);
      const age = entry ? now() - entry.storedAt : Infinity;
      if (entry && age < ttlMs) {
        remember(key, entry);
        return entry.value;
      }
      if (entry && stale && age < ttlMs + stale.ms) {
        // 已在刷新就不再挂一次 catch，否则一次失败会按陈旧命中的次数重复记录
        if (!inflight.has(key)) refresh(key, load).catch((error: unknown) => stale.onError(key, error));
        return entry.value;
      }
      return refresh(key, load);
    },
  };
}
