import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import { createConfigLoader } from '../../src/core/config';
import { ConfigError } from '../../src/core/config-error';
import { defineWidget } from '../../src/core/widget';

const registry = new Map([['note', defineWidget({ type: 'note', options: z.object({}) })]]);
const LAYOUT = `
widgets:
  - { id: a, type: note }
zones:
  - { id: main, items: [a] }
page:
  desktop: { areas: [main], columns: 1fr }
`;

let dir: string;
const write = (file: string, text: string) => writeFile(join(dir, file), text);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'home-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createConfigLoader', () => {
  it('uses defaults when site.yaml and links.yaml are missing', async () => {
    await write('layout.yaml', LAYOUT);
    const config = await createConfigLoader(dir, registry)();
    expect(config.site.title).toBe('Home');
    expect(config.links.links).toEqual([]);
    expect(config.layout.zones.map((z) => z.id)).toEqual(['main']);
  });

  it('requires layout.yaml', async () => {
    const error = await createConfigLoader(dir, registry)().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).problems[0]).toContain('找不到文件');
  });

  it('reports YAML syntax errors with the file name', async () => {
    await write('layout.yaml', LAYOUT);
    await write('site.yaml', 'title: [unclosed');
    const error = await createConfigLoader(dir, registry)().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).file).toBe('site.yaml');
    expect((error as ConfigError).problems[0]).toContain('YAML 语法错误');
  });

  it('reuses the parsed config until a file changes', async () => {
    await write('layout.yaml', LAYOUT);
    await write('site.yaml', 'title: One');
    const load = createConfigLoader(dir, registry);
    const first = await load();
    expect(await load()).toBe(first);

    await write('site.yaml', 'title: Two!');
    expect((await load()).site.title).toBe('Two!');
  });

  it('reports files that exist but cannot be read', async () => {
    await write('layout.yaml', LAYOUT);
    await mkdir(join(dir, 'links.yaml'));
    const error = await createConfigLoader(dir, registry)().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).file).toBe('links.yaml');
    expect((error as ConfigError).problems[0]).toContain('无法读取');
  });

  it('freezes the shared config so one request cannot change what the next one sees', async () => {
    await write('layout.yaml', LAYOUT);
    const config = await createConfigLoader(dir, registry)();
    expect(Object.isFrozen(config.site)).toBe(true);
    expect(Object.isFrozen(config.links.links)).toBe(true);
    expect(Object.isFrozen(config.layout.zones[0]!.items)).toBe(true);
  });
});
