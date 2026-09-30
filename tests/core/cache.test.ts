import { describe, expect, it, vi } from 'vitest';
import { createCache } from '../../src/core/cache';

function setup({ staleMs, maxEntries = 10 }: { staleMs?: number; maxEntries?: number } = {}) {
  let now = 0;
  const onError = vi.fn();
  const stale = staleMs === undefined ? undefined : { ms: staleMs, onError };
  const cache = createCache<string>({ ttlMs: 1000, maxEntries, stale, now: () => now });
  return { cache, onError, advance: (ms: number) => (now += ms) };
}

/** 等待后台刷新（微任务）完成 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createCache', () => {
  it('returns the cached value within the TTL', async () => {
    const { cache, advance } = setup();
    const load = vi.fn(async () => 'v1');
    await expect(cache.get('k', load)).resolves.toBe('v1');
    advance(999);
    await expect(cache.get('k', load)).resolves.toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const { cache } = setup();
    const load = vi.fn(async () => 'v1');
    const results = await Promise.all([cache.get('k', load), cache.get('k', load), cache.get('k', load)]);
    expect(results).toEqual(['v1', 'v1', 'v1']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL when no stale window is configured', async () => {
    const { cache, advance } = setup();
    await cache.get('k', async () => 'v1');
    advance(1000);
    await expect(cache.get('k', async () => 'v2')).resolves.toBe('v2');
  });

  it('serves stale values immediately and refreshes in the background', async () => {
    const { cache, advance } = setup({ staleMs: 5000 });
    await cache.get('k', async () => 'v1');
    advance(2000);
    const load = vi.fn(async () => 'v2');
    await expect(cache.get('k', load)).resolves.toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);
    await flush();
    await expect(cache.get('k', load)).resolves.toBe('v2');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the stale value and reports the error when a background refresh fails', async () => {
    const { cache, onError, advance } = setup({ staleMs: 5000 });
    await cache.get('k', async () => 'v1');
    advance(2000);
    await cache.get('k', async () => Promise.reject(new Error('down')));
    await flush();
    expect(onError).toHaveBeenCalledWith('k', expect.objectContaining({ message: 'down' }));
    await expect(cache.get('k', async () => 'v3')).resolves.toBe('v1');
  });

  it('reports a failed background refresh once, however many stale hits waited on it', async () => {
    const { cache, onError, advance } = setup({ staleMs: 5000 });
    await cache.get('k', async () => 'v1');
    advance(2000);
    let fail!: (error: Error) => void;
    const load = vi.fn(() => new Promise<string>((_, reject) => (fail = reject)));
    await cache.get('k', load);
    await cache.get('k', load);
    await cache.get('k', load);
    fail(new Error('down'));
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reloads in the foreground once an entry has outlived the stale window', async () => {
    const { cache, advance } = setup({ staleMs: 5000 });
    await cache.get('k', async () => 'v1');
    advance(6000);
    await expect(cache.get('k', async () => 'v2')).resolves.toBe('v2');
  });

  it('accepts an options object built ahead of time (npm run check guards the type)', async () => {
    const options = { ttlMs: 1000, maxEntries: 10, stale: { ms: 5000, onError: vi.fn() } };
    await expect(createCache<string>(options).get('k', async () => 'v1')).resolves.toBe('v1');
  });

  it('rejects foreground failures without caching them', async () => {
    const { cache } = setup();
    await expect(cache.get('k', async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(cache.get('k', async () => 'v1')).resolves.toBe('v1');
  });

  it('uses a monotonic clock by default, so a wall-clock step back cannot keep entries fresh', async () => {
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    const wall = vi.spyOn(Date, 'now').mockReturnValue(10_000_000);
    try {
      const cache = createCache<string>({ ttlMs: 1000, maxEntries: 10 });
      await cache.get('k', async () => 'v1');
      wall.mockReturnValue(10_000_000 - 3_600_000);
      perf.mockReturnValue(1000);
      await expect(cache.get('k', async () => 'v2')).resolves.toBe('v2');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('evicts the least recently used entry beyond maxEntries', async () => {
    const { cache } = setup({ maxEntries: 2 });
    await cache.get('a', async () => 'a1');
    await cache.get('b', async () => 'b1');
    await cache.get('a', async () => 'unused');
    await cache.get('c', async () => 'c1');
    await expect(cache.get('a', async () => 'a2')).resolves.toBe('a1');
    await expect(cache.get('b', async () => 'b2')).resolves.toBe('b2');
  });
});
