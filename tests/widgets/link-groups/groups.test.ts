import { describe, expect, it } from 'vitest';
import { parseLinks } from '../../../src/core/links';
import { groupLinks } from '../../../src/widgets/link-groups/groups';

const LINKS = parseLinks({
  categories: [
    { id: 'fun', name: '娱乐', tone: 'pink' },
    { id: 'empty', name: '空' },
    { id: 'dev', name: '开发', tone: 'blue' },
  ],
  links: [
    { name: 'GitHub', url: 'https://github.com', icon: '/icons/github.svg', iconDark: '/icons/github-light.svg', category: 'dev' },
    { name: '只搜索', url: 'https://search-only.example.com' },
    { name: '哔哩哔哩', url: 'https://www.bilibili.com', description: '乾杯~', category: 'fun' },
    { name: 'Docs', url: 'https://docs.example.com/guide', category: 'dev' },
  ],
});

describe('groupLinks', () => {
  it('keeps category order, drops empty categories and links without a category', () => {
    const groups = groupLinks(LINKS);

    expect(groups.map((group) => group.id)).toEqual(['fun', 'dev']);
    expect(groups.map((group) => group.links.map((link) => link.name))).toEqual([['哔哩哔哩'], ['GitHub', 'Docs']]);
  });

  it('carries the tone and shows the description, falling back to the host', () => {
    const [fun, dev] = groupLinks(LINKS);

    expect(fun).toMatchObject({ name: '娱乐', tone: 'pink' });
    expect(fun!.links[0]).toEqual({
      name: '哔哩哔哩',
      url: 'https://www.bilibili.com/',
      meta: '乾杯~',
      icon: 'https://a.favicon.im/www.bilibili.com?larger=true',
    });
    expect(dev!.links).toEqual([
      {
        name: 'GitHub',
        url: 'https://github.com/',
        meta: 'github.com',
        icon: '/icons/github.svg',
        iconDark: '/icons/github-light.svg',
      },
      {
        name: 'Docs',
        url: 'https://docs.example.com/guide',
        meta: 'docs.example.com',
        icon: 'https://a.favicon.im/docs.example.com?larger=true',
      },
    ]);
  });

  it('returns nothing when no link has a category', () => {
    expect(groupLinks(parseLinks({ links: [{ name: 'x', url: 'https://x.com' }] }))).toEqual([]);
  });
});
