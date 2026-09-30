import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLinks } from '../../../src/core/links';
import { parseSite } from '../../../src/core/site';
import { toSiteEntry } from '../../../src/widgets/search/sites';
import { fetchSuggestions } from '../../../src/widgets/search/suggest';
import search from '../../../src/widgets/search/widget';

vi.mock('../../../src/widgets/search/suggest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/widgets/search/suggest')>();
  return { ...actual, fetchSuggestions: vi.fn(async (_provider: string, q: string) => [`${q} one`, `${q} two`]) };
});

const options = (raw: unknown = {}) => search.options.parse(raw);
const suggest = search.actions!.suggest!;
/** 与路由一致：先按 query schema 解析，再执行 */
const run = (opts: ReturnType<typeof options>, q: string, user = 'alice') =>
  suggest.run(opts, suggest.query.parse({ q }), { user, signal: new AbortController().signal, site: parseSite({}), body: undefined });

describe('search widget options', () => {
  it('defaults to every engine, Bing suggestions and site search', () => {
    expect(options()).toMatchObject({ engines: ['google', 'bing', 'duckduckgo', 'brave'], suggest: 'bing', sites: true });
  });

  it('rejects empty, duplicate or unknown engines and unknown suggestion providers', () => {
    for (const raw of [{ engines: [] }, { engines: ['bing', 'bing'] }, { engines: ['yahoo'] }, { suggest: 'yahoo' }]) {
      expect(search.options.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
    expect(options({ suggest: false }).suggest).toBe(false);
  });
});

describe('suggest action', () => {
  beforeEach(() => vi.mocked(fetchSuggestions).mockClear());

  it('normalizes the query and bounds its length', () => {
    expect(suggest.query.safeParse({ q: '  ＨＩ ' })).toMatchObject({ success: true, data: { q: 'hi' } });
    for (const raw of [{}, { q: '   ' }, { q: 'x'.repeat(101) }]) {
      expect(suggest.query.safeParse(raw).success).toBe(false);
    }
  });

  it('checks the length after NFKC normalization, which can expand a single character', () => {
    // U+FDFA 规范化后是 18 个字符，100 个就会变成 1800 个
    expect(suggest.query.safeParse({ q: 'ﷺ'.repeat(6) }).success).toBe(false);
    expect(suggest.query.safeParse({ q: 'ﷺ'.repeat(5) }).success).toBe(true);
  });

  it('fetches from the configured provider once per normalized query', async () => {
    const opts = options({ suggest: 'duckduckgo' });
    await expect(run(opts, 'Astro')).resolves.toEqual(['astro one', 'astro two']);
    await run(opts, 'ＡＳＴＲＯ');
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions).toHaveBeenCalledWith('duckduckgo', 'astro');
  });

  it("keeps each user's cache separate, so response timing cannot reveal what others typed", async () => {
    const opts = options();
    await run(opts, 'secret plan', 'alice');
    await run(opts, 'secret plan', 'bob');
    await run(opts, 'secret plan', 'alice');
    expect(fetchSuggestions).toHaveBeenCalledTimes(2);
  });

  it('never calls the upstream when suggestions are off', async () => {
    await expect(run(options({ suggest: false }), 'astro')).resolves.toEqual([]);
    expect(fetchSuggestions).not.toHaveBeenCalled();
  });
});

describe('toSiteEntry', () => {
  it('keeps only search fields, strips www. from the host and omits missing icons', () => {
    const { links } = parseLinks({
      links: [
        { name: 'A', url: 'https://www.a.example/x', icon: '/icons/a.svg', iconDark: '/icons/a-dark.svg', favorite: true },
        { name: 'B', url: 'https://b.example', description: 'not needed', keywords: ['bee'] },
      ],
    });
    expect(links.map(toSiteEntry)).toEqual([
      { name: 'A', url: 'https://www.a.example/x', host: 'a.example', keywords: [], favorite: true, icon: '/icons/a.svg', iconDark: '/icons/a-dark.svg' },
      { name: 'B', url: 'https://b.example/', host: 'b.example', keywords: ['bee'], favorite: false },
    ]);
  });
});
