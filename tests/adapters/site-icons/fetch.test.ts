import { describe, expect, it, vi } from 'vitest';
import { fetchSiteIcon, iconCandidates, IconFetchError } from '../../../src/adapters/site-icons/fetch';
import { MAX_ICON_BYTES } from '../../../src/adapters/site-icons/store';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PUBLIC = async () => [{ address: '93.184.216.34', family: 4 }];

type Reply = Response | (() => Response);
/** 按完整地址应答；没列出的地址 404 */
function site(routes: Readonly<Record<string, Reply>>) {
  return vi.fn<typeof fetch>(async (input) => {
    const reply = routes[String(input)];
    if (!reply) return new Response('nope', { status: 404 });
    return typeof reply === 'function' ? reply() : reply.clone();
  });
}
const html = (head: string) => new Response(`<!doctype html><html><head>${head}</head><body></body></html>`, { headers: { 'content-type': 'text/html' } });
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });

describe('iconCandidates', () => {
  it('prefers bigger declared sizes, SVGs and touch icons, skips mask icons and ends with /favicon.ico', () => {
    const base = new URL('https://example.com/app/');
    const list = iconCandidates(
      `<link rel="icon" href="/small.png" sizes="16x16">
       <link rel='mask-icon' href='/mask.svg'>
       <link rel="apple-touch-icon" href="touch.png">
       <link href="/big.png" rel="icon" sizes="192x192">
       <link rel="stylesheet" href="/x.css">
       <link rel="shortcut icon" href="https://cdn.example/fav.ico?v=1&amp;x=2">`,
      base,
    );
    expect(list).toEqual([
      'https://example.com/big.png',
      'https://example.com/app/touch.png',
      // 没写尺寸的按 32px 算，比写明 16x16 的靠前
      'https://cdn.example/fav.ico?v=1&x=2',
      'https://example.com/small.png',
      'https://example.com/favicon.ico',
    ]);
  });
});

describe('fetchSiteIcon', () => {
  it('reads the page and downloads the best icon it declares', async () => {
    const fetch = site({
      'https://example.com/some/page': html('<link rel="icon" href="/icon.png" sizes="64x64">'),
      'https://example.com/icon.png': png,
    });
    await expect(fetchSiteIcon('https://example.com/some/page', { fetch, lookup: PUBLIC })).resolves.toEqual(PNG);
  });

  it('upgrades http sites to https, follows redirects and falls back to /favicon.ico', async () => {
    const fetch = site({
      'https://old.example/': new Response(null, { status: 301, headers: { location: 'https://www.old.example/' } }),
      'https://www.old.example/': html(''),
      'https://www.old.example/favicon.ico': png,
    });
    await expect(fetchSiteIcon('http://old.example/', { fetch, lookup: PUBLIC })).resolves.toEqual(PNG);
    expect(fetch.mock.calls.every(([input]) => String(input).startsWith('https://'))).toBe(true);
  });

  it('skips candidates that are not images or are too big', async () => {
    const big = new Uint8Array(MAX_ICON_BYTES + 10);
    big.set(PNG);
    const fetch = site({
      'https://example.com/': html('<link rel="icon" href="/a.png" sizes="512x512"><link rel="icon" href="/b.png" sizes="256x256">'),
      'https://example.com/a.png': () => new Response(big),
      'https://example.com/b.png': () => new Response('<html>login</html>'),
      'https://example.com/favicon.ico': png,
    });
    await expect(fetchSiteIcon('https://example.com/', { fetch, lookup: PUBLIC })).resolves.toEqual(PNG);
  });

  it('never connects to private addresses, even through a redirect', async () => {
    const lookup = async (host: string) => [{ address: host === 'inner.example' ? '10.0.0.5' : '93.184.216.34', family: 4 }];
    const fetch = site({ 'https://example.com/': new Response(null, { status: 302, headers: { location: 'https://inner.example/' } }) });
    await expect(fetchSiteIcon('https://example.com/', { fetch, lookup })).rejects.toThrow(IconFetchError);
    expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain('https://inner.example/');
    await expect(fetchSiteIcon('https://127.0.0.1/', { fetch, lookup })).rejects.toThrow(IconFetchError);
  });

  it('explains when nothing usable was found', async () => {
    await expect(fetchSiteIcon('https://example.com/', { fetch: site({ 'https://example.com/': html('') }), lookup: PUBLIC })).rejects.toThrow(
      '可以自己上传',
    );
  });
});
