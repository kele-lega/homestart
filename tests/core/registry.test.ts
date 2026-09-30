import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import { buildRegistry, registry } from '../../src/core/registry';
import { defineWidget } from '../../src/core/widget';

const note = defineWidget({ type: 'note', options: z.object({}) });

describe('buildRegistry', () => {
  it('keys definitions by their folder name', () => {
    const built = buildRegistry({ '../widgets/note/widget.ts': { default: note } });
    expect([...built.entries()]).toEqual([['note', note]]);
  });

  it('rejects modules without a default definition', () => {
    expect(() => buildRegistry({ '../widgets/note/widget.ts': { note } })).toThrow(/defineWidget/);
  });

  it('rejects a type that does not match its folder', () => {
    expect(() => buildRegistry({ '../widgets/memo/widget.ts': { default: note } })).toThrow(/"memo"/);
  });

  it('discovers the widgets shipped in src/widgets', () => {
    expect(registry.has('placeholder')).toBe(true);
  });

  it('ships every widget folder with both a definition and a view', async () => {
    const root = fileURLToPath(new URL('../../src/widgets/', import.meta.url));
    const folders = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    const incomplete = folders.filter(
      (name) => !existsSync(join(root, name, 'widget.ts')) || !existsSync(join(root, name, 'View.astro')),
    );
    expect(incomplete).toEqual([]);
    expect([...registry.keys()].sort()).toEqual([...folders].sort());
  });
});
