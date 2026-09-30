import { lookup as dnsLookup } from 'node:dns/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  checkUrl,
  checkUrlSyntax,
  isBlockedAddress,
  MAX_URL_LENGTH,
  type LookupFn,
  type ResolvedAddress,
} from '../../../src/adapters/calendar/url-guard';

// 默认解析器换成假的：测试不碰真实 DNS
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const PUBLIC: readonly ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];

function resolveTo(addresses: readonly ResolvedAddress[]) {
  return vi.fn<LookupFn>(async () => addresses);
}

function reasonOf(url: string) {
  const check = checkUrlSyntax(url);
  return check.ok ? 'ok' : check.reason;
}

describe('checkUrlSyntax', () => {
  it('accepts https URLs and trims pasted whitespace', () => {
    // Arrange
    const pasted = '  https://calendar.example/private-abc/basic.ics\n';

    // Act
    const check = checkUrlSyntax(pasted);

    // Assert
    expect(check).toMatchObject({ ok: true });
    expect(check.ok && check.url.href).toBe('https://calendar.example/private-abc/basic.ics');
  });

  it('rejects plain http:// because the private address would travel unencrypted', () => {
    const check = checkUrlSyntax('http://calendar.example/private-abc/basic.ics');
    expect(check).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringContaining('https://') });
    expect(reasonOf('HTTP://calendar.example/a.ics')).toBe('invalid');
  });

  it('rejects malformed input, other schemes and embedded credentials', () => {
    expect(reasonOf('')).toBe('invalid');
    expect(reasonOf('calendar.example/a.ics')).toBe('invalid');
    expect(reasonOf('ftp://calendar.example/a.ics')).toBe('invalid');
    expect(reasonOf('javascript:alert(1)')).toBe('invalid');
    expect(reasonOf('https://user:secret@calendar.example/a.ics')).toBe('invalid');
    expect(reasonOf('https://user@calendar.example/a.ics')).toBe('invalid');
  });

  it('points webcal:// users to https:// instead', () => {
    const check = checkUrlSyntax('webcal://calendar.example/a.ics');
    expect(check).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringContaining('https://') });
  });

  it('limits the length before and after normalisation', () => {
    const base = 'https://calendar.example/';
    expect(reasonOf(base + 'a'.repeat(MAX_URL_LENGTH - base.length))).toBe('ok');
    expect(reasonOf(base + 'a'.repeat(MAX_URL_LENGTH))).toBe('invalid');
    // 原文没超长，空格编码成 %20 以后超长
    expect(reasonOf(base + 'a b'.repeat(600))).toBe('invalid');
  });

  it('rejects control characters instead of silently stripping them', () => {
    expect(reasonOf('https://calendar.example/a\tb.ics')).toBe('invalid');
    expect(reasonOf('https://calendar.example/a\u0000.ics')).toBe('invalid');
    expect(reasonOf('https://calendar.example/a\u0085.ics')).toBe('invalid');
  });

  it('blocks localhost names and private IP literals in any notation', () => {
    const urls = [
      'https://localhost/a.ics',
      'https://LOCALHOST./a.ics',
      'https://cal.localhost/a.ics',
      'https://127.0.0.1/a.ics',
      'https://127.1/a.ics',
      'https://2130706433/a.ics',
      'https://0x7f000001/a.ics',
      'https://0/a.ics',
      'https://10.1.2.3/a.ics',
      'https://172.16.0.1/a.ics',
      'https://192.168.1.1/a.ics',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1/a.ics',
      'https://224.0.0.1/a.ics',
      'https://255.255.255.255/a.ics',
      'https://[::1]/a.ics',
      'https://[::]/a.ics',
      'https://[::ffff:127.0.0.1]/a.ics',
      'https://[::ffff:7f00:1]/a.ics',
      'https://[fd00::1]/a.ics',
      'https://[fe80::1]/a.ics',
      'https://[ff02::1]/a.ics',
      'https://[2002:7f00:1::1]/a.ics',
    ];
    for (const url of urls) expect(reasonOf(url), url).toBe('blocked');
  });

  it('allows public IP literals, including the proxy fake-ip range', () => {
    expect(reasonOf('https://93.184.216.34/a.ics')).toBe('ok');
    expect(reasonOf('https://[2606:2800:220:1:248:1893:25c8:1946]/a.ics')).toBe('ok');
    // Clash 的 fake-ip 模式把每个域名都解析到 198.18.0.0/15，拦掉它开代理时就用不了
    expect(reasonOf('https://198.18.0.5/a.ics')).toBe('ok');
  });

  it('never repeats the URL in its messages', () => {
    const secret = 'private-0123456789abcdef';
    const urls = [
      `ftp://h.example/${secret}`,
      `http://h.example/${secret}`,
      `https://127.0.0.1/${secret}`,
      `webcal://h.example/${secret}`,
    ];
    for (const url of urls) {
      const check = checkUrlSyntax(url);
      expect(check.ok).toBe(false);
      expect(!check.ok && check.message).not.toContain(secret);
    }
  });
});

describe('isBlockedAddress', () => {
  it('blocks every private, local and special-purpose range', () => {
    const blocked = [
      '0.1.2.3',
      '10.255.255.255',
      '100.127.255.255',
      '127.0.0.53',
      '169.254.1.1',
      '172.31.255.255',
      '192.0.0.8',
      '192.0.2.1',
      '192.168.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '239.255.255.250',
      '255.255.255.255',
      '::',
      '::1',
      '100::1',
      '2001:db8::1',
      'fc00::1',
      'fdff:ffff::1',
      'fe80::1%eth0',
      'fec0::1',
      'ff05::2',
    ];
    for (const address of blocked) expect(isBlockedAddress(address), address).toBe(true);
  });

  it('looks inside IPv4-mapped, IPv4-compatible and NAT64 addresses', () => {
    for (const address of ['::ffff:127.0.0.1', '::ffff:10.0.0.1', '::192.168.0.1', '64:ff9b::a9fe:a9fe']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedAddress('64:ff9b::808:808')).toBe(false);
  });

  it('blocks IPv6 transition prefixes and anything outside global unicast', () => {
    const blocked = [
      '2002:7f00:1::1', // 6to4，嵌着 127.0.0.1
      '2002:808:808::1', // 6to4 走公共中继，嵌着的地址无从确认
      '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
      '2001:2::1', // 基准测试
      '2001:10::1', // ORCHID
      '2001:20::1', // ORCHIDv2
      '::ffff:0:7f00:1', // SIIT 翻译地址，嵌着 127.0.0.1
      '3fff::1', // 新的文档示例前缀
      '4000::1', // 全球单播 2000::/3 以外
    ];
    for (const address of blocked) expect(isBlockedAddress(address), address).toBe(true);
    for (const address of ['2606:4700:4700::1111', '2001:4860:4860::8888', '2404:6800:4003:c00::64']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it('allows public addresses and treats anything unrecognised as blocked', () => {
    for (const address of ['8.8.8.8', '100.128.0.1', '172.32.0.1', '2001:4860:4860::8888']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
    expect(isBlockedAddress('')).toBe(true);
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('checkUrl', () => {
  it('resolves the host and accepts it when every address is public', async () => {
    // Arrange
    const lookup = resolveTo(PUBLIC);

    // Act
    const check = await checkUrl('https://Calendar.Example./a.ics', { lookup });

    // Assert
    expect(check).toMatchObject({ ok: true });
    expect(lookup).toHaveBeenCalledWith('calendar.example');
  });

  it('rejects the host when any resolved address is private', async () => {
    const lookup = resolveTo([...PUBLIC, { address: '::ffff:10.0.0.7', family: 6 }]);
    await expect(checkUrl('https://rebind.example/a.ics', { lookup })).resolves.toMatchObject({
      ok: false,
      reason: 'blocked',
    });
  });

  it('fails closed when resolution fails or returns nothing', async () => {
    const failing = vi.fn<LookupFn>(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    });
    await expect(checkUrl('https://gone.example/a.ics', { lookup: failing })).resolves.toMatchObject({
      ok: false,
      reason: 'dns',
    });
    await expect(checkUrl('https://empty.example/a.ics', { lookup: resolveTo([]) })).resolves.toMatchObject({
      ok: false,
      reason: 'dns',
    });
  });

  it('skips DNS for IP literals and for URLs that fail the syntax check', async () => {
    const lookup = resolveTo(PUBLIC);
    await expect(checkUrl('https://93.184.216.34/a.ics', { lookup })).resolves.toMatchObject({ ok: true });
    await expect(checkUrl('https://127.0.0.1/a.ics', { lookup })).resolves.toMatchObject({ reason: 'blocked' });
    await expect(checkUrl('ftp://calendar.example/a.ics', { lookup })).resolves.toMatchObject({ reason: 'invalid' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rethrows the caller’s abort reason instead of reporting a DNS failure', async () => {
    // Arrange
    const controller = new AbortController();
    const reason = new Error('request cancelled');
    const hanging = vi.fn<LookupFn>(() => new Promise(() => {}));

    // Act
    const pending = checkUrl('https://slow.example/a.ics', { lookup: hanging, signal: controller.signal });
    controller.abort(reason);

    // Assert
    await expect(pending).rejects.toBe(reason);
  });

  it('uses the system resolver with every address by default', async () => {
    await expect(checkUrl('https://calendar.example/a.ics')).resolves.toMatchObject({ ok: true });
    expect(dnsLookup).toHaveBeenCalledWith('calendar.example', { all: true });
  });
});
