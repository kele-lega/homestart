import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSite } from '../../../src/core/site';

vi.mock('../../../src/adapters/open-meteo', () => ({ fetchForecast: vi.fn() }));
vi.mock('../../../src/core/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/log')>()),
  logBackgroundError: vi.fn(),
}));

const FORECAST = { temperature: 27.6, code: 0, isDay: true, high: 34.8, low: 27, rainChance: 73, humidity: 78 };
const PINGSHAN = { latitude: 22.72, longitude: 114.35 };
const FRESH_MS = 10 * 60_000;
const STALE_MS = 60 * 60_000;

/** 预报缓存是模块级的：每个用例重新加载模块，互不影响 */
async function setup() {
  vi.resetModules();
  const { default: weather } = await import('../../../src/widgets/weather/widget');
  const { fetchForecast } = await import('../../../src/adapters/open-meteo');
  const { logBackgroundError } = await import('../../../src/core/log');
  const fetch = vi.mocked(fetchForecast).mockReset().mockResolvedValue(FORECAST);
  const log = vi.mocked(logBackgroundError).mockReset();
  const load = (raw: unknown, user = 'alice') =>
    weather.load!(weather.options.parse(raw), { user, signal: new AbortController().signal, site: parseSite({}) });
  return { weather, fetch, log, load };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('weather options', () => {
  it('needs coordinates and takes an optional label', async () => {
    const { weather } = await setup();
    expect(weather.options.parse(PINGSHAN)).toEqual(PINGSHAN);
    expect(weather.options.parse({ label: '坪山', ...PINGSHAN }).label).toBe('坪山');
  });

  it('rejects missing or impossible coordinates, blank labels and unknown keys', async () => {
    const { weather } = await setup();
    const invalid = [
      {},
      { latitude: 22.72 },
      { ...PINGSHAN, latitude: 91 },
      { ...PINGSHAN, longitude: -181 },
      { ...PINGSHAN, label: '' },
      { ...PINGSHAN, city: '坪山' },
    ];
    for (const raw of invalid) {
      expect(weather.options.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
  });
});

describe('weather load', () => {
  it('fetches the forecast for the configured coordinates', async () => {
    const { fetch, load } = await setup();
    await expect(load({ label: '坪山', ...PINGSHAN })).resolves.toEqual(FORECAST);
    expect(fetch).toHaveBeenCalledWith(PINGSHAN);
  });

  it('shares one upstream request per location across users', async () => {
    const { fetch, load } = await setup();
    await Promise.all([load(PINGSHAN, 'alice'), load(PINGSHAN, 'bob')]);
    await load(PINGSHAN, 'alice');
    await load({ latitude: 39.9, longitude: 116.4 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the last forecast while it refreshes, and logs a failed refresh', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { fetch, log, load } = await setup();
    await load(PINGSHAN);
    vi.advanceTimersByTime(FRESH_MS + 1);
    fetch.mockRejectedValueOnce(new Error('offline'));

    await expect(load(PINGSHAN)).resolves.toEqual(FORECAST);
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log).toHaveBeenCalledWith('weather', expect.stringContaining('22.72,114.35'), expect.any(Error));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('loads in the foreground once the cached forecast is too old to trust', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { fetch, load } = await setup();
    await load(PINGSHAN);
    vi.advanceTimersByTime(FRESH_MS + STALE_MS + 1);
    fetch.mockRejectedValueOnce(new Error('offline'));

    await expect(load(PINGSHAN)).rejects.toThrow('offline');
  });
});
