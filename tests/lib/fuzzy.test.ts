import { describe, expect, it } from 'vitest';
import { isStrongMatch, searchEntries, type SearchEntry } from '../../src/lib/fuzzy';

const entry = (name: string, url: string, keywords: string[] = [], favorite = false): SearchEntry => ({
  name,
  url,
  host: new URL(url).hostname.replace(/^www\./, ''),
  keywords,
  favorite,
});

const ENTRIES = [
  entry('Gmail', 'https://mail.google.com/'),
  entry('GitHub', 'https://github.com/', [], true),
  entry('百度翻译', 'https://fanyi.baidu.com/', ['fanyi', 'fy']),
  entry('文本比对助手', 'https://www.diffchecker.com/', ['diff']),
  entry('ChatGPT', 'https://chatgpt.com/'),
  entry('哔哩哔哩', 'https://www.bilibili.com/', [], true),
  entry('QQ邮箱', 'https://mail.qq.com/'),
];

const names = (query: string, limit?: number) => searchEntries(query, ENTRIES, limit).map((e) => e.name);

describe('searchEntries', () => {
  it('ranks prefix matches above substring and subsequence matches', () => {
    expect(names('git')[0]).toBe('GitHub');
    expect(names('ch')[0]).toBe('ChatGPT');
    expect(names('ch')).toContain('文本比对助手');
    expect(names('gml')).toEqual(['Gmail']);
  });

  it('matches keywords, host names and Chinese substrings', () => {
    expect(names('fy')).toEqual(['百度翻译']);
    expect(names('bilibili')).toEqual(['哔哩哔哩']);
    expect(names('翻译')).toEqual(['百度翻译']);
  });

  it('normalizes case, full-width characters and surrounding whitespace', () => {
    expect(names('  ＧＩＴ ')[0]).toBe('GitHub');
    expect(names('QQ')).toEqual(['QQ邮箱']);
  });

  it('scores word starts above plain substrings', () => {
    const list = [
      entry('Retransmit', 'https://a.example/'),
      entry('Google Translate', 'https://b.example/'),
    ];
    expect(searchEntries('trans', list).map((e) => e.name)).toEqual(['Google Translate', 'Retransmit']);
  });

  it('breaks score ties by favorite first, then config order, and respects the limit', () => {
    const list = [
      entry('Docs A', 'https://a.example/'),
      entry('Docs B', 'https://b.example/', [], true),
      entry('Docs C', 'https://c.example/'),
    ];
    expect(searchEntries('docs', list).map((e) => e.name)).toEqual(['Docs B', 'Docs A', 'Docs C']);
    expect(searchEntries('docs', list, 2)).toHaveLength(2);
  });

  it('only matches names and keywords as scattered subsequences, never hosts', () => {
    expect(names('gc')).toEqual([]);
  });

  it('returns nothing for blank queries or when nothing matches', () => {
    expect(names('')).toEqual([]);
    expect(names('   ')).toEqual([]);
    expect(names('zzzz')).toEqual([]);
  });
});

describe('isStrongMatch', () => {
  const [gmail, github, fanyi] = ENTRIES;

  it('accepts exact and prefix matches on names, keywords and hosts', () => {
    expect(isStrongMatch('git', github!)).toBe(true);
    expect(isStrongMatch('FY', fanyi!)).toBe(true);
    expect(isStrongMatch('github.com', github!)).toBe(true);
  });

  it('rejects substring, subsequence and blank matches', () => {
    expect(isStrongMatch('hub', github!)).toBe(false);
    expect(isStrongMatch('gml', gmail!)).toBe(false);
    expect(isStrongMatch(' ', gmail!)).toBe(false);
  });
});
