import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError, logBackgroundError } from '../../src/core/log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logBackgroundError', () => {
  it('writes one line in the same shape as Astro’s own error log', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logBackgroundError('weather', '后台刷新失败', new Error('api.open-meteo.com：请求超时'));

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]).toEqual([
      expect.stringMatching(/^\d{2}:\d{2}:\d{2} \[ERROR\] \[weather\] 后台刷新失败：api\.open-meteo\.com：请求超时$/),
    ]);
  });
});

describe('describeError', () => {
  it('uses the message of an Error and stringifies anything else', () => {
    expect(describeError(new TypeError('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
    expect(describeError(undefined)).toBe('undefined');
  });
});
