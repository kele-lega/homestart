import { describe, expect, it } from 'vitest';
import { THEMES, parseTheme, stepTheme } from '../../src/lib/theme';

describe('parseTheme', () => {
  it('accepts the three known themes', () => {
    for (const theme of THEMES) expect(parseTheme(theme)).toBe(theme);
  });

  it('falls back to following the system for anything else', () => {
    for (const value of [null, undefined, '', 'Dark', 'auto', 1]) expect(parseTheme(value)).toBe('system');
  });
});

describe('stepTheme', () => {
  it('moves through the options in order and wraps at both ends', () => {
    expect(stepTheme('system', 1)).toBe('light');
    expect(stepTheme('light', 1)).toBe('dark');
    expect(stepTheme('dark', 1)).toBe('system');
    expect(stepTheme('system', -1)).toBe('dark');
    expect(stepTheme('light', -1)).toBe('system');
  });
});
