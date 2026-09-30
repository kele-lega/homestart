import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigLoader } from '../../src/core/config';
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

  it('gives every favorite and categorized link an icon', async () => {
    const { links } = await createConfigLoader(resolve('config'), registry)();
    expect(links.links.filter((l) => (l.favorite || l.category) && !l.icon)).toEqual([]);
  });
});
