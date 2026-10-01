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

  it('renders light and dark icons, and derives a favicon when icon is omitted', async () => {
    const html = await render(LINKS);

    expect(html).toMatch(/src="\/icons\/github\.svg"[^>]*data-variant="light"/);
    expect(html).toMatch(/src="\/icons\/github-light\.svg"[^>]*data-variant="dark"/);
    // 哔哩哔哩没填 icon：按域名推导出 favicon.im 地址，不再是首字母
    expect(html).toMatch(/src="https:\/\/a\.favicon\.im\/www\.bilibili\.com\?larger=true"/);
    expect(html).not.toMatch(/class="letter[^"]*"[^>]*>哔</);
    // 服务端渲染不能带内联事件属性（CSP）
    expect(html).not.toMatch(/\son(error|load)=/);
  });

  it('falls back to the first letter when the icon is unusable', async () => {
    // icon 为站内路径但文件不存在：运行时由 SiteIcon 的 error 监听退回首字母。
    // 服务端渲染出的是 <img>，首字母只在浏览器里换上，这里断言图片地址正确即可。
    const html = await render({ links: [{ name: '断链', url: 'https://x.com', icon: '/icons/not-found.svg', favorite: true }] });
    expect(html).toMatch(/src="\/icons\/not-found\.svg"/);
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
