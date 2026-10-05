import { describe, expect, it } from 'vitest';
import { IDENTICON_GRID, identicon } from '../../src/lib/identicon';

const SEED = '0123456789abcdef0123456789abcdef';

describe('identicon', () => {
  it('draws the same picture for the same seed', () => {
    expect(identicon(SEED)).toEqual(identicon(SEED));
  });

  it('draws different pictures for different seeds', () => {
    expect(identicon(SEED)).not.toEqual(identicon('fedcba9876543210fedcba9876543210'));
  });

  it('stays inside the 5×5 grid and is mirrored left to right', () => {
    const { cells } = identicon('5a1f00c3e9b27d4486a0f1e2d3c4b5a6');
    const keys = new Set(cells.map(([column, row]) => `${column},${row}`));
    for (const [column, row] of cells) {
      expect(column).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThan(IDENTICON_GRID);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(IDENTICON_GRID);
      expect(keys.has(`${IDENTICON_GRID - 1 - column},${row}`)).toBe(true);
    }
    expect(keys.size).toBe(cells.length);
  });

  it('fills even nibbles and leaves odd ones empty', () => {
    expect(identicon('0'.repeat(32)).cells).toHaveLength(IDENTICON_GRID * IDENTICON_GRID);
    expect(identicon('1'.repeat(32)).cells).toHaveLength(0);
  });

  it('keeps the color in a mid range that reads on light and dark themes', () => {
    for (const seed of ['0'.repeat(32), 'f'.repeat(32), SEED]) {
      const match = /^hsl\((\d+) (\d+)% (\d+)%\)$/.exec(identicon(seed).color);
      expect(match).not.toBeNull();
      const [hue, saturation, lightness] = match!.slice(1).map(Number) as [number, number, number];
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(359);
      expect(saturation).toBeGreaterThanOrEqual(45);
      expect(saturation).toBeLessThanOrEqual(65);
      expect(lightness).toBeGreaterThanOrEqual(50);
      expect(lightness).toBeLessThanOrEqual(62);
    }
  });
});
