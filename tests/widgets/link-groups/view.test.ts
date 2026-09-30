import { getContainerRenderer } from '@astrojs/svelte/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { beforeAll, describe, expect, it } from 'vitest';
import LinkGroupsView from '../../../src/widgets/link-groups/View.astro';
import linkGroups from '../../../src/widgets/link-groups/widget';
import { viewContext } from '../../helpers';

let container: AstroContainer;
const render = (links: unknown) =>
  container.renderToString(LinkGroupsView, { props: { id: 'links', options: {}, ...viewContext({}, links) } });

const LINKS = {
  categories: [
    { id: 'fun', name: '娱乐', tone: 'pink' },
    { id: 'dev', name: '开发', tone: 'blue' },
  ],
  links: [
    { name: 'GitHub', url: 'https://github.com', icon: '/icons/github.svg', category: 'dev' },
    { name: '只搜索', url: 'https://search-only.example.com' },
    { name: '哔哩哔哩', url: 'https://www.bilibili.com', category: 'fun' },
    { name: 'Docs', url: 'https://docs.example.com/guide', category: 'dev' },
  ],
};

beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

describe('link-groups widget', () => {
  it('is bare and has no options', () => {
    expect(linkGroups.chrome).toBe('bare');
    expect(linkGroups.options.safeParse({ categories: ['dev'] }).success).toBe(false);
  });
});

describe('link-groups view', () => {
  it('renders one collapsed disclosure per category, each controlling its own panel', async () => {
    const html = await render(LINKS);
    const controls = [...html.matchAll(/<button[^>]*aria-controls="([^"]+)"/g)].map((match) => match[1]);

    expect(html).toMatch(/<nav[^>]*aria-label="网站分类"/);
    expect(controls).toEqual(['links_fun_panel', 'links_dev_panel']);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    for (const id of controls) expect(html).toContain(`id="${id}"`);
  });

  it('tints each category and announces how many sites it holds', async () => {
    const html = await render(LINKS);

    expect(html).toMatch(/data-tone="pink"[\s\S]*data-tone="blue"/);
    expect(html).toContain('个网站');
  });

  it('lists every categorized link as a new-tab link, in order', async () => {
    const html = await render(LINKS);
    const hrefs = [...html.matchAll(/<a[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);

    expect(hrefs).toEqual(['https://www.bilibili.com/', 'https://github.com/', 'https://docs.example.com/guide']);
    expect(html.match(/target="_blank"/g)).toHaveLength(3);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
    expect(html).toContain('docs.example.com');
    expect(html).not.toMatch(/\son[a-z]+=/);
  });

  it('explains how to add categories when there are none', async () => {
    const html = await render({ links: [{ name: 'x', url: 'https://x.com' }] });

    expect(html).toContain('categories');
    expect(html).not.toContain('<nav');
  });
});
