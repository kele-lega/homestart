import { describe, expect, it } from 'vitest';
import { normalizeLocation, normalizeTitle, UNTITLED } from '../../../src/adapters/calendar/model';

describe('normalizeTitle', () => {
  it('trims and collapses whitespace, line breaks and control characters', () => {
    // Arrange
    const raw = `  Team\n\tsync${String.fromCharCode(0)}notes  `;

    // Act
    const title = normalizeTitle(raw);

    // Assert
    expect(title).toBe('Team sync notes');
  });

  it('falls back to a placeholder for empty or missing titles', () => {
    expect(normalizeTitle('   ')).toBe(UNTITLED);
    expect(normalizeTitle(undefined)).toBe(UNTITLED);
    expect(normalizeTitle(42)).toBe(UNTITLED);
  });

  it('keeps at most 200 code points without splitting surrogate pairs', () => {
    expect(normalizeTitle('a'.repeat(250))).toHaveLength(200);
    const emoji = normalizeTitle(String.fromCodePoint(0x1f600).repeat(201));
    expect(Array.from(emoji)).toHaveLength(200);
    expect(emoji.isWellFormed()).toBe(true);
  });
});

describe('normalizeLocation', () => {
  it('cleans the text the same way and drops empty locations', () => {
    expect(normalizeLocation('  Room\r\n 101 ')).toBe('Room 101');
    expect(normalizeLocation(' \n ')).toBeUndefined();
    expect(normalizeLocation(null)).toBeUndefined();
  });
});
