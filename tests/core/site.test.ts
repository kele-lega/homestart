import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/core/config-error';
import { parseSite } from '../../src/core/site';

describe('parseSite', () => {
  it('fills defaults for an empty file', () => {
    expect(parseSite(null)).toEqual({
      title: 'Home',
      favicon: '/favicon.ico',
      lang: 'zh-CN',
      timezone: 'Asia/Shanghai',
    });
  });

  it('rejects unknown time zones', () => {
    expect(() => parseSite({ timezone: 'Mars/Olympus' })).toThrow(ConfigError);
  });

  it.each(['url(x)', '/a b.png', 'https://x.com/bg.png', '//evil.example/bg.png', '/images/../secret.png'])('rejects the background %s', (background) => {
    expect(() => parseSite({ background })).toThrow(/background/);
  });

  it('rejects unknown keys so typos are noticed', () => {
    expect(() => parseSite({ titel: 'x' })).toThrow(ConfigError);
  });
});
