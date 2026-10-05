import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../../src/core/rate-limit';

function setup(limit: number, maxKeys: number) {
  let now = 0;
  const allow = createRateLimiter({ limit, windowMs: 1000, maxKeys, now: () => now });
  return { allow, advance: (ms: number) => (now += ms) };
}

describe('createRateLimiter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('allows up to the limit per window and resets afterwards', () => {
    const { allow, advance } = setup(2, 10);
    expect([allow('u'), allow('u'), allow('u')]).toEqual([true, true, false]);
    advance(999);
    expect(allow('u')).toBe(false);
    advance(1);
    expect(allow('u')).toBe(true);
  });

  it('counts keys independently and forgets the key idle for longest beyond maxKeys', () => {
    const { allow } = setup(1, 2);
    expect([allow('a'), allow('b')]).toEqual([true, true]);
    expect(allow('c')).toBe(true);
    // a 最久没有请求，被淘汰后重新开始计数
    expect(allow('a')).toBe(true);
    expect(allow('c')).toBe(false);
  });

  it('keeps a throttled key tracked, so flooding other keys cannot reset its budget', () => {
    const { allow } = setup(1, 2);
    allow('a');
    allow('b');
    // a 被拒绝也算一次访问，淘汰的应该是 b
    expect(allow('a')).toBe(false);
    allow('c');
    expect(allow('a')).toBe(false);
    expect(allow('b')).toBe(true);
  });

  it('uses a monotonic clock by default, so a wall-clock step back cannot stretch the window', () => {
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    const wall = vi.spyOn(Date, 'now').mockReturnValue(10_000_000);
    const allow = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 10 });
    expect([allow('u'), allow('u')]).toEqual([true, false]);
    wall.mockReturnValue(10_000_000 - 3_600_000);
    perf.mockReturnValue(1000);
    expect(allow('u')).toBe(true);
  });
});
