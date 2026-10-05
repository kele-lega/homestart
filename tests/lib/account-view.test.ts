import { describe, expect, it } from 'vitest';
import { avatarOf, describeDevice, formatWhen, toSessionView, toUserView } from '../../src/lib/account-view';

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:135.0) Gecko/20100101 Firefox/135.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
};

describe('describeDevice', () => {
  it.each([
    [UA.chromeWindows, 'Chrome · Windows'],
    [UA.edgeWindows, 'Edge · Windows'],
    [UA.operaWindows, 'Opera · Windows'],
    [UA.safariIphone, 'Safari · iPhone'],
    [UA.chromeIphone, 'Chrome · iPhone'],
    [UA.safariIpad, 'Safari · iPad'],
    [UA.firefoxMac, 'Firefox · macOS'],
    [UA.chromeAndroid, 'Chrome · Android'],
    [UA.firefoxLinux, 'Firefox · Linux'],
  ])('names %s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  it('falls back when nothing is recognisable', () => {
    expect(describeDevice(null)).toBe('未知设备');
    expect(describeDevice('')).toBe('未知设备');
    expect(describeDevice('curl/8.9.1')).toBe('未知设备');
  });

  it('keeps whichever half it recognises', () => {
    expect(describeDevice('SomeBot (Windows)')).toBe('Windows');
  });
});

describe('avatarOf', () => {
  it('points an uploaded avatar at its served path', () => {
    expect(avatarOf({ avatarSeed: 'abc', avatarFile: '0123456789abcdef0123456789abcdef.webp' })).toEqual({
      seed: 'abc',
      image: '/avatars/0123456789abcdef0123456789abcdef.webp',
    });
  });

  it('falls back to the identicon seed without an upload', () => {
    expect(avatarOf({ avatarSeed: 'abc', avatarFile: null })).toEqual({ seed: 'abc', image: null });
  });
});

describe('formatWhen', () => {
  it('formats in the site time zone, independent of the server time zone', () => {
    const ms = Date.UTC(2026, 8, 30, 6, 5);
    expect(formatWhen(ms, 'Asia/Shanghai')).toBe('2026.09.30 14:05');
    expect(formatWhen(ms, 'America/New_York')).toBe('2026.09.30 02:05');
  });
});

describe('toSessionView', () => {
  it('replaces the user agent with a device name and marks the current session', () => {
    const source = { id: 3, userAgent: UA.firefoxMac, ip: null, remember: false, createdAt: 1, lastSeenAt: 2 };
    expect(toSessionView(source, 3)).toEqual({
      id: 3,
      device: 'Firefox · macOS',
      ip: null,
      remember: false,
      createdAt: 1,
      lastSeenAt: 2,
      current: true,
    });
    expect(toSessionView(source, 4).current).toBe(false);
  });
});

describe('toUserView', () => {
  it('keeps only the time of the last login', () => {
    const user = {
      id: 1,
      username: 'a',
      displayName: null,
      role: 'user' as const,
      createdAt: 5,
      lastLogin: { at: 9, ip: '203.0.113.1' },
      email: 'a@example.com',
      signupMethod: 'github' as const,
      avatarSeed: 'seed',
      avatarFile: null,
    };
    expect(toUserView(user)).toEqual({
      id: 1,
      username: 'a',
      displayName: null,
      avatar: { seed: 'seed', image: null },
      role: 'user',
      createdAt: 5,
      lastLoginAt: 9,
      email: 'a@example.com',
      signupMethod: 'github',
    });
    expect(toUserView({ ...user, lastLogin: null }).lastLoginAt).toBeNull();
  });
});
