import { describe, expect, it } from 'vitest';
import { parseLinks } from '../../src/core/links';
import {
  describeUserLinksIssue,
  fromLinksConfig,
  parseUserLinks,
  toLinksConfig,
  USER_LINKS_LIMITS,
  UserLinksSchema,
} from '../../src/core/user-links';

const DEFAULTS = parseLinks({
  categories: [
    { id: 'dev', name: '开发', tone: 'blue' },
    { id: 'fun', name: '娱乐', tone: 'green' },
  ],
  links: [
    { name: 'GitHub', url: 'https://github.com', icon: '/icons/github.svg', iconDark: '/icons/github-light.svg', category: 'dev', favorite: true, keywords: ['gh'] },
    { name: 'B 站', url: 'https://www.bilibili.com', category: 'fun' },
    { name: '只搜索', url: 'https://search-only.example' },
  ],
});

describe('UserLinksSchema', () => {
  it('normalizes addresses and trims names', () => {
    expect(UserLinksSchema.parse({ categories: [{ name: ' 工具 ', links: [{ name: ' 翻译 ', url: 'https://Fanyi.Example' }] }] })).toEqual({
      categories: [{ name: '工具', links: [{ name: '翻译', url: 'https://fanyi.example/' }] }],
    });
  });

  it('enforces the limits and rejects duplicate category names', () => {
    const category = (name: string, links = 0) => ({ name, links: Array.from({ length: links }, (_, i) => ({ name: `s${i}`, url: `https://s${i}.example` })) });
    const tooMany = { categories: Array.from({ length: USER_LINKS_LIMITS.categories + 1 }, (_, i) => category(`c${i}`)) };
    expect(UserLinksSchema.safeParse(tooMany).success).toBe(false);
    expect(UserLinksSchema.safeParse({ categories: [category('a', USER_LINKS_LIMITS.links + 1)] }).success).toBe(false);
    expect(UserLinksSchema.safeParse({ categories: [category('a'), category('a')] }).success).toBe(false);
    expect(UserLinksSchema.safeParse({ categories: [] }).success).toBe(true);
  });

  it('only accepts stored, bundled or https icons — never arbitrary same-site paths or javascript:', () => {
    const withIcon = (icon: string) => UserLinksSchema.safeParse({ categories: [{ name: 'a', links: [{ name: 'x', url: 'https://x.example', icon }] }] }).success;
    expect(withIcon('/site-icons/0123456789abcdef0123456789abcdef.png')).toBe(true);
    expect(withIcon('/icons/github.svg')).toBe(true);
    expect(withIcon('https://cdn.example/icon.png')).toBe(true);
    expect(withIcon('/api/auth/logout')).toBe(false);
    expect(withIcon('/icons/../api/x')).toBe(false);
    expect(withIcon('javascript:alert(1)')).toBe(false);
    expect(withIcon('http://cdn.example/icon.png')).toBe(false);
  });

  it('rejects other link schemes', () => {
    expect(UserLinksSchema.safeParse({ categories: [{ name: 'a', links: [{ name: 'x', url: 'javascript:alert(1)' }] }] }).success).toBe(false);
  });
});

describe('describeUserLinksIssue', () => {
  it('says which category and which site is wrong', () => {
    const input = { categories: [{ name: '开发', links: [] }, { name: '工具', links: [{ name: 'x', url: 'ftp://x' }] }] };
    const result = UserLinksSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(describeUserLinksIssue(input, result.error!.issues[0]!)).toBe('第 2 个分类「工具」的第 1 个网站：网址必须以 http:// 或 https:// 开头');
  });

  it('falls back to the plain message for problems with the whole list', () => {
    expect(describeUserLinksIssue({}, { path: ['categories'], message: '最多 5 个分类' })).toBe('最多 5 个分类');
  });
});

describe('parseUserLinks', () => {
  it('reads entries that no longer validate as not set', () => {
    expect(parseUserLinks({ categories: 'nope' })).toBeUndefined();
    expect(parseUserLinks({ categories: [] })).toEqual({ categories: [] });
  });
});

describe('fromLinksConfig / toLinksConfig', () => {
  it('starts the editor from links.yaml, dropping links without a category', () => {
    expect(fromLinksConfig(DEFAULTS)).toEqual({
      categories: [
        {
          name: '开发',
          links: [{ name: 'GitHub', url: 'https://github.com/', icon: '/icons/github.svg', iconDark: '/icons/github-light.svg', keywords: ['gh'], favorite: true }],
        },
        { name: '娱乐', links: [{ name: 'B 站', url: 'https://www.bilibili.com/', icon: 'https://a.favicon.im/www.bilibili.com?larger=true' }] },
      ],
    });
  });

  it('turns an account navigation into a LinksConfig, keeping tones of same-named categories', () => {
    const config = toLinksConfig(
      { categories: [{ name: '娱乐', links: [{ name: 'B 站', url: 'https://www.bilibili.com/' }] }, { name: '新分类', links: [] }] },
      DEFAULTS,
    );
    expect(config.categories).toEqual([
      { id: 'c1', name: '娱乐', tone: 'green' },
      { id: 'c2', name: '新分类', tone: 'blue' },
    ]);
    expect(config.links).toEqual([{ name: 'B 站', url: 'https://www.bilibili.com/', category: 'c1', favorite: false, keywords: [] }]);
    expect(config.faviconService).toBe(DEFAULTS.faviconService);
  });

  it('round-trips the defaults', () => {
    const back = toLinksConfig(fromLinksConfig(DEFAULTS), DEFAULTS);
    expect(back.links.map((link) => link.url)).toEqual(['https://github.com/', 'https://www.bilibili.com/']);
    expect(back.links[0]).toMatchObject({ favorite: true, keywords: ['gh'], iconDark: '/icons/github-light.svg' });
  });
});
