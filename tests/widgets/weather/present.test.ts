import { describe, expect, it } from 'vitest';
import type { Forecast } from '../../../src/adapters/open-meteo';
import { present } from '../../../src/widgets/weather/present';

const SUNNY: Forecast = { temperature: 27.6, code: 0, isDay: true, high: 34.8, low: 27, rainChance: 73, humidity: 78.4 };

describe('present', () => {
  it('rounds the numbers and names the condition', () => {
    expect(present(SUNNY)).toEqual({
      temperature: '28°',
      condition: '晴',
      range: { high: '35°', low: '27°' },
    });
  });

  it('names WMO codes in Chinese', () => {
    const names = [2, 3, 45, 63, 75, 82, 95].map((code) => present({ ...SUNNY, code }).condition);
    expect(names).toEqual(['多云', '阴', '雾', '中雨', '大雪', '强阵雨', '雷阵雨']);
  });

  it('says so for codes it does not know', () => {
    expect(present({ ...SUNNY, code: 42 }).condition).toBe('天气未知');
  });

  it('drops the range when either end is missing and never shows -0°', () => {
    expect(present({ ...SUNNY, high: undefined }).range).toBeUndefined();
    expect(present({ ...SUNNY, low: undefined }).range).toBeUndefined();
    expect(present({ ...SUNNY, temperature: -0.4 }).temperature).toBe('0°');
  });
});
