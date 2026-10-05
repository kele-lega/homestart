import { describe, expect, it, vi } from 'vitest';
import { fetchForecast } from '../../src/adapters/open-meteo';
import { UpstreamError } from '../../src/core/http';

const PINGSHAN = { latitude: 22.72, longitude: 114.35 };

/** 与 2026-09-29 实际返回的结构一致，只保留用到的字段 */
const BODY = {
  current: { time: '2026-09-29T07:00', temperature_2m: 27.6, relative_humidity_2m: 78, weather_code: 0, is_day: 1 },
  daily: {
    time: ['2026-09-29'],
    temperature_2m_max: [34.8],
    temperature_2m_min: [27],
    precipitation_probability_max: [73],
  },
};

function respond(body: unknown) {
  return vi.fn<typeof fetch>(async () => Response.json(body));
}

describe('fetchForecast', () => {
  it('asks for current conditions and today in the location’s own time zone', async () => {
    const fetch = respond(BODY);
    await fetchForecast(PINGSHAN, { fetch });

    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '22.72',
      longitude: '114.35',
      current: 'temperature_2m,relative_humidity_2m,weather_code,is_day',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '1',
    });
  });

  it('maps the response to a forecast', async () => {
    await expect(fetchForecast(PINGSHAN, { fetch: respond(BODY) })).resolves.toEqual({
      temperature: 27.6,
      code: 0,
      isDay: true,
      high: 34.8,
      low: 27,
      rainChance: 73,
      humidity: 78,
    });
  });

  it('leaves out values the model does not have', async () => {
    const current = { ...BODY.current, relative_humidity_2m: null, is_day: 0 };
    const daily = { time: ['2026-09-29'], temperature_2m_max: [null], temperature_2m_min: [], precipitation_probability_max: [null] };
    const forecast = await fetchForecast(PINGSHAN, { fetch: respond({ current, daily }) });
    expect(forecast).toEqual({
      temperature: 27.6,
      code: 0,
      isDay: false,
      high: undefined,
      low: undefined,
      rainChance: undefined,
      humidity: undefined,
    });
  });

  it('still accepts a response without the humidity field', async () => {
    const { relative_humidity_2m: _, ...current } = BODY.current;
    await expect(fetchForecast(PINGSHAN, { fetch: respond({ ...BODY, current }) })).resolves.toMatchObject({ humidity: undefined });
  });

  it('rejects a response without usable current conditions', async () => {
    for (const current of [undefined, { ...BODY.current, temperature_2m: null }, { ...BODY.current, weather_code: 1.5 }]) {
      const result = fetchForecast(PINGSHAN, { fetch: respond({ ...BODY, current }) });
      await expect(result).rejects.toThrow(UpstreamError);
    }
  });

  it('names the invalid fields in the error, for the server log', async () => {
    const result = fetchForecast(PINGSHAN, { fetch: respond({ ...BODY, current: { ...BODY.current, is_day: 'yes' } }) });
    await expect(result).rejects.toThrow(/current\.is_day/);
  });
});
