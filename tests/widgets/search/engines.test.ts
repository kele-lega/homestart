import { describe, expect, it } from 'vitest';
import { ENGINE_IDS, ENGINES, searchUrl } from '../../../src/widgets/search/engines';
import { parseSuggestions, suggestUrl } from '../../../src/widgets/search/suggest';

describe('searchUrl', () => {
  it('builds each engine URL with the query percent-encoded', () => {
    expect(searchUrl('google', 'astro 天气')).toBe('https://www.google.com/search?q=astro+%E5%A4%A9%E6%B0%94');
    expect(searchUrl('bing', 'a&b=c')).toBe('https://www.bing.com/search?q=a%26b%3Dc');
    expect(searchUrl('yandex', 'x')).toBe('https://yandex.com/search/?text=x');
    expect(searchUrl('baidu', '中 文')).toBe('https://www.baidu.com/s?wd=%E4%B8%AD+%E6%96%87');
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
    expect(url.pathname).toBe('/qsonhs.aspx');
    expect(url.searchParams.get('q')).toBe('astro 天气');
    const baidu = new URL(suggestUrl('baidu', '天气'));
    expect([baidu.host, baidu.searchParams.get('wd'), baidu.searchParams.get('ie'), baidu.searchParams.get('action')]).toEqual([
      'suggestion.baidu.com',
      '天气',
      'utf-8',
      'opensearch',
    ]);
    expect(new URL(suggestUrl('yandex', 'x')).searchParams.get('part')).toBe('x');
  });
});

describe('parseSuggestions', () => {
  it('reads the OpenSearch suggestion array and ignores extra members', () => {
    expect(parseSuggestions('baidu', ['astro', ['astro build', 'astro db'], [], { extra: true }], 'astro')).toEqual([
      'astro build',
      'astro db',
    ]);
  });

  it('drops blanks, duplicates, the query itself and overlong entries, then caps the list', () => {
    const many = ['Astro', ' astro ', '', 'a'.repeat(201), ...Array.from({ length: 12 }, (_, i) => `astro ${i}`)];
    const result = parseSuggestions('yandex', ['astro', many], 'astro');
    expect(result).toHaveLength(8);
    expect(result[0]).toBe('astro 0');
    expect(new Set(result).size).toBe(result.length);
  });

  it('drops malformed UTF-16 (lone surrogates), which the browser cannot URL-encode', () => {
    expect(parseSuggestions('google', ['astro', ['astro \ud800', 'astro 😀', '\udfff']], 'astro')).toEqual(['astro 😀']);
  });

  it('rejects payloads that are not OpenSearch shaped', () => {
    expect(() => parseSuggestions('baidu', { q: 'astro' }, 'astro')).toThrow();
    expect(() => parseSuggestions('baidu', ['astro', [1, 2]], 'astro')).toThrow();
  });

  it("reads Bing's own suggestion format, including the empty answer without Results", () => {
    const payload = {
      AS: {
        Query: 'astro',
        FullResults: 1,
        Results: [
          { Type: 'AS', Suggests: [{ Txt: 'astro', Type: 'LC' }, { Txt: 'astro build', Type: 'LS' }] },
          { Type: 'AS', Suggests: [{ Txt: 'astro db', Type: 'LS' }] },
        ],
      },
    };
    expect(parseSuggestions('bing', payload, 'astro')).toEqual(['astro build', 'astro db']);
    expect(parseSuggestions('bing', { AS: { Query: 'zxq', FullResults: 0 } }, 'zxq')).toEqual([]);
    expect(() => parseSuggestions('bing', ['astro', ['astro build']], 'astro')).toThrow();
  });
});
