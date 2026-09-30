import { describe, expect, it } from 'vitest';
import { ENGINE_IDS, ENGINES, searchUrl } from '../../../src/widgets/search/engines';
import { parseSuggestions, suggestUrl } from '../../../src/widgets/search/suggest';

describe('searchUrl', () => {
  it('builds each engine URL with the query percent-encoded', () => {
    expect(searchUrl('google', 'astro 天气')).toBe('https://www.google.com/search?q=astro+%E5%A4%A9%E6%B0%94');
    expect(searchUrl('bing', 'a&b=c')).toBe('https://www.bing.com/search?q=a%26b%3Dc');
    expect(searchUrl('duckduckgo', 'x')).toBe('https://duckduckgo.com/?q=x');
    expect(searchUrl('brave', 'x')).toBe('https://search.brave.com/search?q=x');
  });

  it('keeps every engine on https with a form-compatible action', () => {
    for (const id of ENGINE_IDS) {
      const { action, param } = ENGINES[id];
      expect(new URL(action).protocol).toBe('https:');
      expect(param).toMatch(/^[a-z]+$/);
    }
  });
});

describe('suggestUrl', () => {
  it('targets the fixed provider host with the encoded query', () => {
    const url = new URL(suggestUrl('bing', 'astro 天气'));
    expect(url.host).toBe('api.bing.com');
    expect(url.searchParams.get('query')).toBe('astro 天气');
  });
});

describe('parseSuggestions', () => {
  it('reads the OpenSearch suggestion array and ignores extra members', () => {
    expect(parseSuggestions(['astro', ['astro build', 'astro db'], [], { extra: true }], 'astro')).toEqual([
      'astro build',
      'astro db',
    ]);
  });

  it('drops blanks, duplicates, the query itself and overlong entries, then caps the list', () => {
    const many = ['Astro', ' astro ', '', 'a'.repeat(201), ...Array.from({ length: 12 }, (_, i) => `astro ${i}`)];
    const result = parseSuggestions(['astro', many], 'astro');
    expect(result).toHaveLength(8);
    expect(result[0]).toBe('astro 0');
    expect(new Set(result).size).toBe(result.length);
  });

  it('drops malformed UTF-16 (lone surrogates), which the browser cannot URL-encode', () => {
    expect(parseSuggestions(['astro', ['astro \ud800', 'astro 😀', '\udfff']], 'astro')).toEqual(['astro 😀']);
  });

  it('rejects payloads that are not OpenSearch shaped', () => {
    expect(() => parseSuggestions({ q: 'astro' }, 'astro')).toThrow();
    expect(() => parseSuggestions(['astro', [1, 2]], 'astro')).toThrow();
  });
});
