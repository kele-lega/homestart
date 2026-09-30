import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveLayout, type ResolvedZone } from '../../src/core/layout';
import { registry } from '../../src/core/registry';
import Zone from '../../src/zones/Zone.astro';
import { viewContext } from '../helpers';

const layout = resolveLayout(
  {
    widgets: [
      { id: 'a', type: 'placeholder', title: 'A' },
      { id: 'b', type: 'placeholder', title: 'B' },
      { id: 'c', type: 'placeholder', title: 'C' },
      { id: 'bad', type: 'nope' },
    ],
    zones: [
      { id: 'fold', title: '插件', layout: 'grid', mobile: 'collapse', items: ['a'] },
      { id: 'plain', items: [['b', 'c'], 'bad'] },
    ],
    page: { desktop: { areas: ['fold plain'], columns: '1fr 1fr' }, mobile: { order: ['c', 'fold'] } },
  },
  registry,
);

const ctx = viewContext();
let container: AstroContainer;
const render = (zone: ResolvedZone) => container.renderToString(Zone, { props: { zone, ctx } });

beforeAll(async () => {
  container = await AstroContainer.create();
});

describe('Zone', () => {
  it('wires the mobile toggle to its panel and nests widget headings under the zone title', async () => {
    const html = await render(layout.zones[0]!);

    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBe('z-fold_panel');
    expect(html).toContain(`id="${controls}"`);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/<h2 class="l-zone-title"/);
    expect(html).toMatch(/<h3 class="l-frame-title"[^>]*>\s*A\s*<\/h3>/);
  });

  it('renders untitled zones with h2 widget titles, merged cards and per-widget errors', async () => {
    const html = await render(layout.zones[1]!);

    expect(html).not.toContain('l-zone-title');
    expect(html).not.toContain('aria-controls');
    expect(html).toMatch(/<h2 class="l-frame-title"[^>]*>\s*C\s*<\/h2>/);
    expect(html.match(/class="l-card"[\s\S]*?id="w-b"[\s\S]*?id="w-c"/)).not.toBeNull();
    expect(html).toContain('--order-m:0');
    expect(html).toMatch(/<p class="l-frame-error"[^>]*>[^<]*&quot;nope&quot;/);
  });

  it('marks ruled and masthead zones only when the layout asks for them', async () => {
    const plain = await render(layout.zones[1]!);
    expect(plain).not.toContain('data-dividers');
    expect(plain).not.toContain('data-masthead');

    const ruled = await render({ ...layout.zones[1]!, dividers: 'both', masthead: true });
    expect(ruled).toMatch(/class="l-zone"[^>]*data-masthead/);
    expect(ruled).toMatch(/class="l-zone-body"[^>]*data-dividers="both"/);
  });
});
