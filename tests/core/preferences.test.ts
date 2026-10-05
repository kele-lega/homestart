import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigLoader } from '../../src/core/config';
import { findWidget } from '../../src/core/layout';
import { applyPatch, parsePreferences, personalize } from '../../src/core/preferences';
import { registry } from '../../src/core/registry';

const loadConfig = createConfigLoader(resolve('tests/fixtures/preferences-config'), registry);
const optionsOf = async (preferences: Record<string, unknown>, id: string) =>
  findWidget(personalize(await loadConfig(), preferences, registry).layout, id)?.options;

const PINGSHAN = { label: '坪山', latitude: 22.69, longitude: 114.33 };

describe('parsePreferences', () => {
  it('keeps only registered widget types whose preference passes their schema', () => {
    const raw = {
      weather: PINGSHAN,
      clock: { seconds: 'yes' },
      steam: { count: 6 },
      gone: { anything: true },
      placeholder: {},
    };
    expect(parsePreferences(raw, registry)).toEqual({ weather: PINGSHAN, steam: { count: 6 } });
  });

  it('drops the greeting keys of clock preferences saved before the greeting was removed, keeping the rest', () => {
    const raw = { clock: { seconds: true, greeting: true, name: '冲凉', date: true, weekday: false, lunar: true, festival: true } };
    expect(parsePreferences(raw, registry)).toEqual({
      clock: { seconds: true, date: true, weekday: false, lunar: true, festival: true },
    });
  });

  it('reads anything that is not an object as no preferences', () => {
    for (const raw of [undefined, null, 'weather', [], 3]) expect(parsePreferences(raw, registry)).toEqual({});
  });
});

describe('applyPatch', () => {
  it('replaces the patched types, removes the ones set to null and keeps the rest', () => {
    const result = applyPatch({ weather: PINGSHAN, steam: { count: 6 } }, { steam: null, deadline: { max: 3, days: 30 } }, registry);
    expect(result).toEqual({ ok: true, next: { weather: PINGSHAN, deadline: { max: 3, days: 30 } } });
  });

  it('reads clock preferences saved before the date-line switches existed as showing every part', () => {
    const result = applyPatch({}, { clock: { seconds: true, lunar: false } }, registry);
    expect(result).toEqual({
      ok: true,
      next: { clock: { seconds: true, date: true, weekday: true, lunar: false, festival: true } },
    });
  });

  it('rejects unknown types and invalid values as a whole, with a readable message', () => {
    expect(applyPatch({}, { placeholder: {} }, registry)).toEqual({ ok: false, message: '没有可以设置的「placeholder」' });
    expect(applyPatch({}, { steam: { count: 11 } }, registry)).toEqual({ ok: false, message: '最多列 10 款' });
    expect(applyPatch({}, { search: { engine: 'yahoo', suggest: true, sites: true } }, registry)).toEqual({
      ok: false,
      message: '没有这个搜索引擎',
    });
  });

  it('does not touch the current preferences', () => {
    const current = Object.freeze({ steam: { count: 6 } });
    applyPatch(current, { steam: null }, registry);
    expect(current).toEqual({ steam: { count: 6 } });
  });
});

describe('personalize', () => {
  it('returns the very same config when there is nothing to merge', async () => {
    const config = await loadConfig();
    expect(personalize(config, {}, registry)).toBe(config);
  });

  it('merges each preference into every instance of that type, including widgets inside cards', async () => {
    const preferences = { weather: PINGSHAN, deadline: { max: 3, days: 365 }, steam: { count: 2 } };
    expect(await optionsOf(preferences, 'weather')).toEqual(PINGSHAN);
    expect(await optionsOf(preferences, 'deadline')).toEqual({ max: 3, days: 365 });
    expect(await optionsOf(preferences, 'steam')).toEqual({ count: 2 });
  });

  it('leaves widgets with a configuration error alone', async () => {
    const config = personalize(await loadConfig(), { weather: PINGSHAN }, registry);
    const broken = findWidget(config.layout, 'broken-weather');
    expect(broken?.error).toBeDefined();
    expect(broken?.options).toBeUndefined();
  });

  it('puts the chosen engine first, and ignores engines the site does not offer', async () => {
    const pick = (engine: string) => optionsOf({ search: { engine, suggest: false, sites: true } }, 'search');
    expect(await pick('google')).toMatchObject({ engines: ['google', 'bing'] });
    expect(await pick('brave')).toMatchObject({ engines: ['bing', 'google'] });
  });

  it('turns suggestions on with a fallback provider when the site has them off, and can turn them off', async () => {
    expect(await optionsOf({ search: { engine: 'bing', suggest: true, sites: false } }, 'search')).toMatchObject({
      suggest: 'bing',
      sites: false,
    });
    expect(await optionsOf({ search: { engine: 'bing', suggest: false, sites: true } }, 'search')).toMatchObject({
      suggest: false,
    });
  });

  it('merges an old clock preference that still carries the greeting into valid clock options', async () => {
    const saved = parsePreferences({ clock: { seconds: true, greeting: true, name: '' } }, registry);
    expect(await optionsOf(saved, 'clock')).toEqual({
      seconds: true,
      date: true,
      weekday: true,
      lunar: true,
      festival: true,
    });
  });

  it('falls back to the configured options when the merged result no longer validates', async () => {
    // 存进去之后管理员把上限调小了之类：直接塞一个不合格的偏好，模拟这种情况
    expect(await optionsOf({ steam: { count: 99 } }, 'steam')).toEqual({ count: 4 });
  });
});
