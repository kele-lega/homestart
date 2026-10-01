import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigLoader } from '../../src/core/config';
import { deriveIcon, parseLinks } from '../../src/core/links';
import { registry } from '../../src/core/registry';

// 仓库自带的 config/ 必须始终能通过校验
describe('shipped config', () => {
  it('loads without errors or warnings', async () => {
    const config = await createConfigLoader(resolve('config'), registry)();
    expect(config.layout.warnings).toEqual([]);
    const errors = config.layout.zones
      .flatMap((z) => z.items)
      .flatMap((item) => (item.kind === 'card' ? item.widgets : [item]))
      .filter((w) => w.error);
    expect(errors).toEqual([]);
  });

  it('derives an icon for every favorite and categorized link', async () => {
    const { links } = await createConfigLoader(resolve('config'), registry)();
    expect(links.links.filter((l) => (l.favorite || l.category) && !l.icon)).toEqual([]);
  });

  it('derives icons from the link host, not from a fixed default', async () => {
    const { links } = await createConfigLoader(resolve('config'), registry)();
    // 仓库自带的配置里 icon 都是手填的，所以这里断言推导函数本身对任意链接生效
    const sample = parseLinks({ links: [{ name: 'x', url: 'https://sub.example.com/a' }] }).links[0]!;
    expect(sample.icon).toBe(deriveIcon('https://sub.example.com/a', links.faviconService));
    expect(sample.icon).toContain('sub.example.com');
  });
});
