import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigLoader } from '../../src/core/config';
import { registry } from '../../src/core/registry';
import { hasWidget, preferenceSections } from '../../src/core/settings-view';

const loadConfig = createConfigLoader(resolve('tests/fixtures/preferences-config'), registry);
const onlySearch = createConfigLoader(resolve('tests/fixtures/api-config'), registry);

describe('preferenceSections', () => {
  it('derives every default from layout.yaml, in the shape of the preference', async () => {
    expect(preferenceSections(await loadConfig(), {})).toEqual({
      weather: {
        defaults: { label: '北京', latitude: 39.9, longitude: 116.39 },
        saved: undefined,
      },
      search: {
        defaults: { engine: 'bing', suggest: false, sites: true },
        saved: undefined,
        engines: ['bing', 'google'],
      },
      clock: {
        defaults: {
          seconds: false,
          date: true,
          weekday: true,
          lunar: true,
          festival: true,
        },
        saved: undefined,
      },
      deadline: { defaults: { max: 5, days: 90 }, saved: undefined },
      steam: { defaults: { count: 4 }, saved: undefined },
    });
  });

  it('hands back what the user saved next to the defaults', async () => {
    const sections = preferenceSections(await loadConfig(), {
      steam: { count: 6 },
    });
    expect(sections.steam).toEqual({
      defaults: { count: 4 },
      saved: { count: 6 },
    });
    expect(sections.weather?.saved).toBeUndefined();
  });

  it('leaves out the widgets that are not on the page', async () => {
    const sections = preferenceSections(await onlySearch(), {});
    expect(
      Object.entries(sections)
        .filter(([, section]) => section)
        .map(([type]) => type),
    ).toEqual(['search']);
  });
});

describe('hasWidget', () => {
  it('is true when any of the types is placed and valid', async () => {
    const config = await loadConfig();
    expect(hasWidget(config, 'agenda', 'deadline')).toBe(true);
    expect(hasWidget(config, 'agenda')).toBe(false);
    expect(hasWidget(await onlySearch(), 'calendar', 'agenda', 'deadline')).toBe(false);
  });
});
