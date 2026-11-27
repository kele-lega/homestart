import { describe, expect, it } from 'vitest';
import { COUPLETS, coupletPool, SEASON_COUPLETS } from '../../src/ink/couplets';
import { LIAN_PERIOD, lianIndex } from '../../src/ink/lian';
import { currentTerm, seasonOfTerm, SOLAR_TERMS } from '../../src/lib/cn-calendar';

describe('ink couplets', () => {
  it('has one couplet for every solar term, and nothing else', () => {
    expect(Object.keys(COUPLETS).sort()).toEqual([...SOLAR_TERMS].sort());
  });

  it('pairs lines of equal length and names the source', () => {
    for (const [term, { first, second, source }] of Object.entries(COUPLETS)) {
      expect([...first].length, term).toBe([...second].length);
      expect(source, term).toMatch(/^.+《.+》$/);
    }
  });

  it('covers whatever term the calendar library reports', () => {
    for (let month = 1; month <= 12; month++) {
      for (const day of [1, 8, 15, 22]) expect(COUPLETS[currentTerm(2026, month, day).name]).toBeDefined();
    }
  });

  const all = [...Object.values(COUPLETS), ...Object.values(SEASON_COUPLETS).flat()];

  it('keeps every line to seven characters or fewer, so the hanging column fits', () => {
    for (const { first, second } of all) {
      expect([...first].length, first).toBeLessThanOrEqual(7);
      expect([...second].length, second).toBeLessThanOrEqual(7);
    }
  });

  it('gives each season a dozen-odd couplets of matching length with a source', () => {
    for (const [season, list] of Object.entries(SEASON_COUPLETS)) {
      expect(list.length, season).toBeGreaterThanOrEqual(10);
      for (const { first, second, source } of list) {
        expect([...first].length, first).toBe([...second].length);
        expect(source, first).toMatch(/^.+《.+》$/);
      }
    }
  });

  it('never hangs the same line twice', () => {
    const lines = all.flatMap(({ first, second }) => [first, second]);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('pools the term couplet first, then the rest of its season', () => {
    for (const term of SOLAR_TERMS) {
      const pool = coupletPool(term);
      expect(pool[0]).toBe(COUPLETS[term]);
      expect(pool.length).toBe(1 + SEASON_COUPLETS[seasonOfTerm(term)].length);
    }
  });

  it('turns to the next couplet every period and wraps around', () => {
    expect(lianIndex(5, 0)).toBe(0);
    expect(lianIndex(5, LIAN_PERIOD - 1)).toBe(0);
    expect(lianIndex(5, LIAN_PERIOD)).toBe(1);
    expect(lianIndex(5, LIAN_PERIOD * 7)).toBe(2);
    expect(lianIndex(0, 12345)).toBe(0);
  });
});
