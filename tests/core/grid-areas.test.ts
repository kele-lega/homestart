import { describe, expect, it } from 'vitest';
import { isSafeTrackList, parseAreas } from '../../src/core/grid-areas';

describe('parseAreas', () => {
  it('returns the named areas of a valid template', () => {
    const result = parseAreas(['header header', 'side main', 'footer footer']);
    expect(result.problems).toEqual([]);
    expect(result.names).toEqual(['header', 'side', 'main', 'footer']);
  });

  it('ignores null cells made of dots', () => {
    const result = parseAreas(['a . b', 'a ... b']);
    expect(result.problems).toEqual([]);
    expect(result.names).toEqual(['a', 'b']);
  });

  it('reports rows with different column counts', () => {
    const result = parseAreas(['a b', 'a']);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('列数');
  });

  it('reports areas that are not rectangles', () => {
    const result = parseAreas(['a a', 'a b']);
    expect(result.problems).toEqual(['区域 "a" 必须是矩形']);
  });

  it('reports names that are not valid identifiers', () => {
    const result = parseAreas(['a "b;']);
    expect(result.problems.some((p) => p.includes('"b;'))).toBe(true);
  });

  it('reports an empty template', () => {
    expect(parseAreas([]).problems).toHaveLength(1);
  });
});

describe('isSafeTrackList', () => {
  it.each(['1fr', 'minmax(16rem, 1fr) minmax(0, 2.2fr)', 'repeat(4, minmax(0, 1fr))', 'auto 1fr auto'])(
    'accepts %s',
    (value) => expect(isSafeTrackList(value)).toBe(true),
  );

  it.each(['1fr; color: red', 'url("x")', '', '1fr}'])('rejects %s', (value) =>
    expect(isSafeTrackList(value)).toBe(false),
  );
});
