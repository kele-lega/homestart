import { getContainerRenderer } from '@astrojs/svelte/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { beforeAll, describe, expect, it } from 'vitest';
import FavoritesView from '../../../src/widgets/favorites/View.astro';
import type { WidgetHeading } from '../../../src/core/widget';
import favorites from '../../../src/widgets/favorites/widget';
import { viewContext, withoutDevAnnotations } from '../../helpers';

let container: AstroContainer;
const HEADING: WidgetHeading = { title: '常用网站', level: 2 };
const render = async (links: unknown, heading?: WidgetHeading) =>
  withoutDevAnnotations(
    await container.renderToString(FavoritesView, {
      props: { id: 'favorites', options: {}, heading, ...viewContext({}, links) },
    }),
  );

const LINKS = {
  links: [
    { name: 'GitHub', url: 'https://github.com', icon: '/icons/github.svg', iconDark: '/icons/github-light.svg', favorite: true },
    { name: 'Docs', url: 'https://docs.example.com' },
    { name: '哔哩哔哩', url: 'https://www.bilibili.com', favorite: true },
  ],
};

beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

describe('favorites widget', () => {
  it('has no options (editing happens in links.yaml only)', () => {
    expect(favorites.options.safeParse({}).success).toBe(true);
    expect(favorites.options.safeParse({ editable: true }).success).toBe(false);
  });

  it('draws its own head so the count can sit on the right', () => {
    expect(favorites.head).toBe('view');
  });
});

describe('favorites view', () => {
  it('renders favorite links in config order as new-tab tiles', async () => {
    const html = await render(LINKS);
    const hrefs = [...html.matchAll(/<a[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);

    expect(hrefs).toEqual(['https://github.com/', 'https://www.bilibili.com/']);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('Docs');
  });

  it('renders light and dark icons, or a letter when there is no icon', async () => {
    const html = await render(LINKS);

    expect(html).toMatch(/src="\/icons\/github\.svg"[^>]*data-variant="light"/);
    expect(html).toMatch(/src="\/icons\/github-light\.svg"[^>]*data-variant="dark"/);
    expect(html).toMatch(/class="letter[^"]*"[^>]*>哔</);
    // 服务端渲染不能带内联事件属性（CSP）
    expect(html).not.toMatch(/\son(error|load)=/);
  });

  it('explains how to add favorites when there are none', async () => {
    const html = await render({ links: [{ name: 'Docs', url: 'https://docs.example.com' }] });

    expect(html).toContain('favorite: true');
    expect(html).not.toContain('<ul');
  });

  it('shows the heading with the favorite count on the right', async () => {
    const html = await render(LINKS, HEADING);

    expect(html).toMatch(/<h2 class="l-frame-title">常用网站<\/h2>\s*<span class="l-frame-sub">2 个<\/span>/);
  });

  it('keeps the heading but drops the count when there are no favorites', async () => {
    const html = await render({ links: [{ name: 'Docs', url: 'https://docs.example.com' }] }, HEADING);

    expect(html).toContain('<h2 class="l-frame-title">常用网站</h2>');
    expect(html).not.toContain('l-frame-sub');
  });

  it('has no head when the instance has no title', async () => {
    const html = await render(LINKS);

    expect(html).not.toContain('l-frame-head');
  });
});
