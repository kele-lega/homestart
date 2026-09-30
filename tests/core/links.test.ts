import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/core/config-error';
import { parseLinks } from '../../src/core/links';

function problemsOf(raw: unknown): readonly string[] {
  try {
    parseLinks(raw);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected parseLinks to throw');
}

describe('parseLinks', () => {
  it('applies defaults', () => {
    const links = parseLinks({
      categories: [{ id: 'ai', name: 'AI' }],
      links: [{ name: 'ChatGPT', url: 'https://chatgpt.com', category: 'ai', icon: '/icons/chatgpt.svg' }],
    });
    expect(links.links[0]).toEqual({
      name: 'ChatGPT',
      url: 'https://chatgpt.com/',
      category: 'ai',
      icon: '/icons/chatgpt.svg',
      favorite: false,
      keywords: [],
    });
  });

  it('normalizes urls so quotes and angle brackets are percent-encoded', () => {
    const [link] = parseLinks({ links: [{ name: 'x', url: 'https://x.com/a"<b>' }] }).links;
    expect(link!.url).toBe('https://x.com/a%22%3Cb%3E');
  });

  it.each(['//evil.example/a.png', '/icons/../../etc/passwd', 'http://x.com/a.png'])('rejects the icon %s', (icon) => {
    const problems = problemsOf({ links: [{ name: 'x', url: 'https://x.com', icon }] });
    expect(problems[0]).toMatch(/^links\.0\.icon: /);
  });

  it('treats an empty file as no links', () => {
    expect(parseLinks(null)).toEqual({ categories: [], links: [] });
  });

  it('gives categories a neutral tone unless a known tone is set', () => {
    const { categories } = parseLinks({
      categories: [
        { id: 'dev', name: '开发' },
        { id: 'fun', name: '娱乐', tone: 'pink' },
      ],
    });
    expect(categories).toEqual([
      { id: 'dev', name: '开发', tone: 'neutral' },
      { id: 'fun', name: '娱乐', tone: 'pink' },
    ]);
    expect(problemsOf({ categories: [{ id: 'dev', name: '开发', tone: 'rainbow' }] })[0]).toMatch(
      /^categories\.0\.tone: /,
    );
  });

  it.each(['javascript:alert(1)', 'ftp://example.com', 'not a url'])('rejects the url %s', (url) => {
    expect(problemsOf({ links: [{ name: 'x', url }] })[0]).toMatch(/^links\.0\.url: /);
  });

  it('trims names and descriptions, and rejects names that are only whitespace', () => {
    const { links } = parseLinks({ links: [{ name: ' GitHub ', url: 'https://github.com', description: '  ' }] });
    expect(links[0]).toMatchObject({ name: 'GitHub', description: '' });
    expect(problemsOf({ links: [{ name: '   ', url: 'https://x.com' }] })[0]).toMatch(/^links\.0\.name: /);
    expect(problemsOf({ categories: [{ id: 'dev', name: ' ' }] })[0]).toMatch(/^categories\.0\.name: /);
  });

  it('rejects icons that are neither site paths nor https urls', () => {
    const problems = problemsOf({ links: [{ name: 'x', url: 'https://x.com', icon: 'http://x.com/a.png' }] });
    expect(problems[0]).toMatch(/^links\.0\.icon: /);
  });

  it('reports unknown and duplicate categories', () => {
    const problems = problemsOf({
      categories: [
        { id: 'ai', name: 'AI' },
        { id: 'ai', name: 'AI 2' },
      ],
      links: [{ name: 'Steam', url: 'https://store.steampowered.com', category: 'games' }],
    });
    expect(problems).toEqual(['分类 "ai" 重复', '链接 "Steam" 的分类 "games" 不存在']);
  });
});
