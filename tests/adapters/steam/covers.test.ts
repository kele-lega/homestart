import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSteamCover } from '../../../src/adapters/steam/covers';
import { UpstreamError } from '../../../src/core/http';

const APP_ID = 4115450;
const FORMAT = `steam/apps/${APP_ID}/\${FILENAME}?t=1793261976`;
const PORTRAIT = 'b42db0199ac5f681ea604e8a2abd62253debae38/library_capsule_schinese.jpg';
const HEADER = '40b2044606b59e0cdd9fb89738895fea8a22067c/header_schinese.jpg';
const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets';

function response(assets: unknown) {
  return { response: { store_items: [{ appid: APP_ID, success: 1, assets }] } };
}

function fakeFetch(body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchSteamCover', () => {
  it('resolves Phantom Blade Zero hashed portrait assets via the official API without a key', async () => {
    const fetch = fakeFetch(response({ asset_url_format: FORMAT, library_capsule: PORTRAIT, header: HEADER }));
    await expect(fetchSteamCover(APP_ID, { fetch })).resolves.toBe(`${CDN}/steam/apps/${APP_ID}/${PORTRAIT}?t=1793261976`);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(`${url.origin}${url.pathname}`).toBe('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/');
    expect(url.searchParams.has('key')).toBe(false);
    expect(JSON.parse(url.searchParams.get('input_json')!)).toEqual({
      ids: [{ appid: APP_ID }],
      context: { language: 'schinese', country_code: 'CN' },
      data_request: { include_assets: true },
    });
  });

  it('uses the real header when there is no portrait', async () => {
    const fetch = fakeFetch(response({ asset_url_format: FORMAT, header: HEADER }));
    await expect(fetchSteamCover(APP_ID, { fetch })).resolves.toBe(`${CDN}/steam/apps/${APP_ID}/${HEADER}?t=1793261976`);
  });

  it('supports legacy assets without hashes or timestamps', async () => {
    const fetch = fakeFetch(response({ asset_url_format: `steam/apps/${APP_ID}/\${FILENAME}`, library_capsule: 'library_600x900.jpg' }));
    await expect(fetchSteamCover(APP_ID, { fetch })).resolves.toBe(`${CDN}/steam/apps/${APP_ID}/library_600x900.jpg`);
  });

  it.each([
    { response: {} },
    { response: { store_items: [{ appid: APP_ID, success: 2 }] } },
    { response: { store_items: [{ appid: 570, success: 1 }] } },
    response({ asset_url_format: FORMAT }),
  ])('keeps the legacy header as a last resort when no assets are available', async (body) => {
    await expect(fetchSteamCover(APP_ID, { fetch: fakeFetch(body) })).resolves.toBe(`${CDN}/steam/apps/${APP_ID}/header.jpg`);
  });

  it.each(['https://evil.example/${FILENAME}', 'steam/apps/570/${FILENAME}', `steam/apps/${APP_ID}/../../\${FILENAME}`])('rejects unexpected asset formats: %s', async (format) => {
    const fetch = fakeFetch(response({ asset_url_format: format, library_capsule: PORTRAIT }));
    await expect(fetchSteamCover(APP_ID, { fetch })).rejects.toBeInstanceOf(UpstreamError);
  });

  it.each(['../other.jpg', '//evil.example/image.jpg', 'https://evil.example/image.jpg', 'image.jpg?redirect=1'])('ignores unsafe filenames: %s', async (file) => {
    const fetch = fakeFetch(response({ asset_url_format: FORMAT, library_capsule: file, header: HEADER }));
    await expect(fetchSteamCover(APP_ID, { fetch })).resolves.toBe(`${CDN}/steam/apps/${APP_ID}/${HEADER}?t=1793261976`);
  });

  it('reports malformed data and upstream failures', async () => {
    await expect(fetchSteamCover(APP_ID, { fetch: fakeFetch({ response: { store_items: 'invalid' } }) })).rejects.toBeInstanceOf(UpstreamError);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('', { status: 503 }));
    await expect(fetchSteamCover(APP_ID, { fetch })).rejects.toMatchObject({ status: 503 });
  });
});

describe('resolveSteamCover', () => {
  it('shares cached results across users, coalesces concurrent requests, and expires after a day', async () => {
    vi.resetModules();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { resolveSteamCover } = await import('../../../src/adapters/steam/covers');
    const fetch = fakeFetch(response({ asset_url_format: FORMAT, library_capsule: PORTRAIT }));
    vi.stubGlobal('fetch', fetch);
    const [first, second] = await Promise.all([resolveSteamCover(APP_ID), resolveSteamCover(APP_ID)]);
    expect(first).toBe(second);
    await expect(resolveSteamCover(APP_ID)).resolves.toBe(first);
    expect(fetch).toHaveBeenCalledOnce();
    clock.mockReturnValue(24 * 3_600_000);
    await resolveSteamCover(APP_ID);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    vi.resetModules();
    const { resolveSteamCover } = await import('../../../src/adapters/steam/covers');
    const fetch = fakeFetch(response({ asset_url_format: FORMAT, library_capsule: PORTRAIT }));
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);
    await expect(resolveSteamCover(APP_ID)).rejects.toMatchObject({ name: 'UpstreamError' });
    await resolveSteamCover(APP_ID);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
