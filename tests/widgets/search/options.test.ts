import { describe, expect, it } from 'vitest';
import {
  announce,
  buildOptions,
  defaultKey,
  isSuggestable,
  keepsChoice,
  MAX_QUERY,
  MAX_SUGGESTIONS,
  optionId,
  readSuggestions,
  resolveActive,
  stepKey,
  targetOf,
  type SearchOption,
} from '../../../src/widgets/search/options';
import type { SiteEntry } from '../../../src/widgets/search/sites';

const site = (name: string, url: string, keywords: string[] = []): SiteEntry => ({
  name,
  url,
  host: new URL(url).hostname,
  keywords,
  favorite: false,
});

const SITES = [
  site('GitHub', 'https://github.com/'),
  site('Gmail', 'https://mail.google.com/'),
  site('百度翻译', 'https://fanyi.baidu.com/', ['fanyi', 'translate']),
];

const keys = (options: readonly SearchOption[]) => options.map((option) => option.key);

describe('buildOptions', () => {
  it('returns nothing for a blank query', () => {
    expect(buildOptions('   ', SITES, ['x'])).toEqual([]);
  });

  it('orders sites, then the web search row, then suggestions', () => {
    const options = buildOptions('git', SITES, ['git clone', 'gitlab']);
    expect(keys(options)).toEqual(['site:0', 'web', 'suggest:git clone', 'suggest:gitlab']);
    expect(options[1]).toEqual({ kind: 'web', key: 'web', text: 'git' });
  });

  it('drops duplicate suggestions and ones equal to the query', () => {
    const options = buildOptions(' Astro ', [], ['astro', 'ASTRO', 'astro docs', 'astro docs']);
    expect(keys(options)).toEqual(['web', 'suggest:astro docs']);
    expect(options[0]).toMatchObject({ text: 'Astro' });
  });

  it('caps suggestions after filtering', () => {
    const many = ['q', ...Array.from({ length: 10 }, (_, i) => `q${i}`)];
    const options = buildOptions('q', [], many);
    expect(options.filter((option) => option.kind === 'suggest')).toHaveLength(MAX_SUGGESTIONS);
    expect(options.at(-1)).toMatchObject({ text: `q${MAX_SUGGESTIONS - 1}` });
  });
});

describe('defaultKey / resolveActive', () => {
  it('prefers a strongly matching site', () => {
    expect(defaultKey(buildOptions('git', SITES, []), 'git')).toBe('site:0');
    expect(defaultKey(buildOptions('fanyi', SITES, []), 'fanyi')).toBe('site:0');
  });

  it('falls back to the web row for weak matches or no sites', () => {
    expect(defaultKey(buildOptions('hub', SITES, []), 'hub')).toBe('web');
    expect(defaultKey(buildOptions('weather', SITES, []), 'weather')).toBe('web');
    expect(defaultKey([], '')).toBeUndefined();
  });

  it('keeps a chosen key only while it is still listed', () => {
    const options = buildOptions('git', SITES, ['gitlab']);
    expect(resolveActive(options, 'suggest:gitlab', 'git')).toBe('suggest:gitlab');
    expect(resolveActive(options, 'suggest:gone', 'git')).toBe('site:0');
    expect(resolveActive(options, undefined, 'git')).toBe('site:0');
  });
});

describe('stepKey', () => {
  const options = buildOptions('git', SITES, ['gitlab']);

  it('moves and wraps around', () => {
    expect(stepKey(options, 'site:0', 1)).toBe('web');
    expect(stepKey(options, 'suggest:gitlab', 1)).toBe('site:0');
    expect(stepKey(options, 'site:0', -1)).toBe('suggest:gitlab');
  });

  it('starts from the ends when nothing is active', () => {
    expect(stepKey(options, undefined, 1)).toBe('site:0');
    expect(stepKey(options, undefined, -1)).toBe('suggest:gitlab');
    expect(stepKey([], undefined, 1)).toBeUndefined();
  });
});

describe('targetOf', () => {
  it('opens sites directly and searches everything else', () => {
    const [github, web, suggestion] = buildOptions('git', SITES, ['git 教程']);
    expect(targetOf(github!, 'google')).toBe('https://github.com/');
    expect(targetOf(web!, 'bing')).toBe('https://www.bing.com/search?q=git');
    expect(targetOf(suggestion!, 'duckduckgo')).toBe('https://duckduckgo.com/?q=git+%E6%95%99%E7%A8%8B');
  });
});

describe('readSuggestions', () => {
  it('accepts only a string list inside the envelope', () => {
    expect(readSuggestions({ success: true, data: ['a', 'b'], error: null })).toEqual(['a', 'b']);
    expect(readSuggestions({ success: true, data: ['a', 1] })).toEqual([]);
    expect(readSuggestions({ success: false, data: null, error: 'x' })).toEqual([]);
    expect(readSuggestions(null)).toEqual([]);
    expect(readSuggestions('oops')).toEqual([]);
  });

  it('drops malformed strings that would make optionId throw while rendering', () => {
    expect(readSuggestions({ success: true, data: ['a', 'b\ud800'] })).toEqual(['a']);
    expect(() => readSuggestions({ success: true, data: ['\udc00'] }).map((text) => optionId('s', text))).not.toThrow();
  });

  it('keeps emoji, whose surrogates come in pairs', () => {
    expect(readSuggestions({ success: true, data: ['🍣 寿司'] })).toEqual(['🍣 寿司']);
  });

  it('works in browsers without String#isWellFormed (Safari before 16.4)', () => {
    const original = Object.getOwnPropertyDescriptor(String.prototype, 'isWellFormed')!;
    Reflect.deleteProperty(String.prototype, 'isWellFormed');
    try {
      expect(readSuggestions({ success: true, data: ['a', 'b\ud800'] })).toEqual(['a']);
    } finally {
      Object.defineProperty(String.prototype, 'isWellFormed', original);
    }
  });
});

describe('isSuggestable', () => {
  it('measures the query after normalization, exactly like the server', () => {
    expect(isSuggestable('astro')).toBe(true);
    expect(isSuggestable('   ')).toBe(false);
    expect(isSuggestable('x'.repeat(MAX_QUERY))).toBe(true);
    expect(isSuggestable('x'.repeat(MAX_QUERY + 1))).toBe(false);
    // U+FDFA 规范化后是 18 个字符；e 加组合重音 U+0301 规范化后合成一个字符。按码点构造，免得源码被编辑器规范化
    const ligature = String.fromCodePoint(0xfdfa);
    const decomposed = `e${String.fromCodePoint(0x301)}`;
    expect(isSuggestable(ligature.repeat(5))).toBe(true);
    expect(isSuggestable(ligature.repeat(6))).toBe(false);
    expect(isSuggestable(decomposed.repeat(MAX_QUERY))).toBe(true);
    expect(isSuggestable(decomposed.repeat(MAX_QUERY + 1))).toBe(false);
  });
});

describe('keepsChoice', () => {
  const next = buildOptions('g', SITES, ['gmail login']);

  it('accepts new suggestions unless they would drop the suggestion the user picked', () => {
    expect(keepsChoice(next, undefined)).toBe(true);
    expect(keepsChoice(next, 'web')).toBe(true);
    expect(keepsChoice(next, 'site:0')).toBe(true);
    expect(keepsChoice(next, 'suggest:gmail login')).toBe(true);
    expect(keepsChoice(next, 'suggest:gmail')).toBe(false);
  });
});

describe('optionId', () => {
  it('derives a stable, whitespace-free element id from the option key', () => {
    const id = optionId('search', 'suggest:天气 预报');
    expect(id).toBe(optionId('search', 'suggest:天气 预报'));
    expect(id).toMatch(/^search-option-\S+$/);
    expect(optionId('search', 'suggest:a')).not.toBe(optionId('search', 'suggest:b'));
  });
});

describe('announce', () => {
  it('tells screen reader users how many rows there are and what Enter will do', () => {
    const options = buildOptions('git', SITES, []);
    expect(announce(options, 'site:0', 'google')).toBe(`${options.length} 个选项，回车打开 GitHub`);
    expect(announce(options, 'web', 'bing')).toBe(`${options.length} 个选项，回车用 Bing 搜索 git`);
  });

  it('describes a picked suggestion and stays silent without options', () => {
    const options = buildOptions('astro', SITES, ['astro docs']);
    expect(announce(options, 'suggest:astro docs', 'google')).toBe(`${options.length} 个选项，回车用 Google 搜索 astro docs`);
    expect(announce([], undefined, 'google')).toBe('');
  });
});
