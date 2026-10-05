import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PLACES, mergePlaces, searchPlaces } from '../../src/adapters/geocoding';
import { UpstreamError } from '../../src/core/http';

/** 与 2026 年实际返回的结构一致，只保留用到的字段 */
const METEO = {
  results: [
    { name: '坪山', latitude: 22.69396, longitude: 114.33463, country: '中国', admin1: '广东', admin2: '深圳' },
    { name: '坪山', latitude: 30.09655, longitude: 107.42439, country: '中国', admin1: '重庆市', admin2: '重庆市' },
    { name: '坪山', latitude: 1 },
  ],
};

const NOMINATIM = [
  {
    name: '坪山区',
    category: 'boundary',
    lat: '22.7113827',
    lon: '114.3461882',
    address: { county: '坪山区', city: '深圳市', state: '广东省', country: '中国', postcode: '518118' },
  },
  { name: '坪山', category: 'railway', lat: '22.708', lon: '114.322', address: {} },
  { name: '坪山', category: 'place', lat: '26.6597898', lon: '102.9759049', address: { county: '会东县', state: '四川省', country: '中国' } },
  { name: '', category: 'place', lat: '1', lon: '2' },
];

type Body = unknown | Error;

/** 按主机名分别应答两家；Error 表示那一家网络出错 */
function upstreams(meteo: Body, nominatim: Body, init?: ResponseInit) {
  return vi.fn<typeof fetch>(async (input) => {
    const body = new URL(String(input)).hostname.startsWith('nominatim') ? nominatim : meteo;
    if (body instanceof Error) throw body;
    return Response.json(body, init);
  });
}

const urlOf = (fetch: ReturnType<typeof upstreams>, host: string) =>
  fetch.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.hostname === host)!;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('searchPlaces', () => {
  it('asks both Nominatim and Open-Meteo for a few places in the site language', async () => {
    const fetch = upstreams(METEO, NOMINATIM);
    await searchPlaces('坪山', { fetch, lang: 'zh-CN' });

    const meteo = urlOf(fetch, 'geocoding-api.open-meteo.com');
    expect(meteo.pathname).toBe('/v1/search');
    expect(Object.fromEntries(meteo.searchParams)).toEqual({ name: '坪山', count: String(MAX_PLACES), language: 'zh', format: 'json' });

    const nominatim = urlOf(fetch, 'nominatim.openstreetmap.org');
    expect(nominatim.pathname).toBe('/search');
    expect(Object.fromEntries(nominatim.searchParams)).toMatchObject({
      q: '坪山',
      format: 'jsonv2',
      limit: String(MAX_PLACES),
      'accept-language': 'zh-CN',
      layer: 'address',
    });
    // Nominatim 的使用规定要求能认出应用的 User-Agent
    const call = fetch.mock.calls.find(([input]) => String(input).includes('nominatim'))!;
    expect(new Headers(call[1]?.headers).get('user-agent')).toMatch(/^homestart\//);
  });

  it('lists Nominatim first, drops the same place from Open-Meteo, and skips stations and malformed entries', async () => {
    await expect(searchPlaces('坪山', { fetch: upstreams(METEO, NOMINATIM) })).resolves.toEqual([
      { name: '坪山区', region: '深圳市 · 广东省 · 中国', latitude: 22.7113827, longitude: 114.3461882 },
      { name: '坪山', region: '会东县 · 四川省 · 中国', latitude: 26.6597898, longitude: 102.9759049 },
      { name: '坪山', region: '重庆市 · 中国', latitude: 30.09655, longitude: 107.42439 },
    ]);
  });

  it('finds places Open-Meteo only knows by their full name, e.g. 清远 → 清远市', async () => {
    const qingyuan = [
      { name: '清远市', category: 'boundary', lat: '23.6832984', lon: '113.0505994', address: { city: '清远市', state: '广东省', country: '中国' } },
    ];
    await expect(searchPlaces('清远', { fetch: upstreams({ generationtime_ms: 0.1 }, qingyuan) })).resolves.toEqual([
      { name: '清远市', region: '广东省 · 中国', latitude: 23.6832984, longitude: 113.0505994 },
    ]);
  });

  it('answers an empty list when neither found anything', async () => {
    await expect(searchPlaces('qqqq', { fetch: upstreams({ generationtime_ms: 0.2 }, []) })).resolves.toEqual([]);
  });

  it('still answers with one source when the other fails, and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(searchPlaces('坪山', { fetch: upstreams(METEO, new TypeError('fetch failed')) })).resolves.toHaveLength(2);
    await expect(searchPlaces('坪山', { fetch: upstreams({ results: 'nope' }, NOMINATIM) })).resolves.toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('reports an upstream error only when both sources fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(searchPlaces('坪山', { fetch: upstreams({ results: 'nope' }, { not: 'a list' }) })).rejects.toThrow(UpstreamError);
    await expect(searchPlaces('坪山', { fetch: upstreams({}, {}, { status: 500 }) })).rejects.toThrow('HTTP 500');
  });
});

describe('mergePlaces', () => {
  const place = (name: string, latitude: number, longitude: number) => ({ name, region: '', latitude, longitude });

  it('keeps the first of places within about 10 km of each other and caps the list', () => {
    expect(mergePlaces([place('a', 22.7, 114.34)], [place('b', 22.69, 114.33), place('c', 23.7, 113.03)])).toEqual([
      place('a', 22.7, 114.34),
      place('c', 23.7, 113.03),
    ]);
    const many = Array.from({ length: 12 }, (_, index) => place(String(index), index, 0));
    expect(mergePlaces(many)).toHaveLength(MAX_PLACES);
  });
});
