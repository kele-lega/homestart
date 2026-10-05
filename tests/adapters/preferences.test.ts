import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPreferencesService,
  createPreferencesStore,
  DEFAULT_PREFERENCES_FILE,
  preferencesFilePath,
} from '../../src/adapters/preferences';
import { ANONYMOUS } from '../../src/core/api';
import { createConfigLoader } from '../../src/core/config';
import { findWidget } from '../../src/core/layout';
import { registry } from '../../src/core/registry';
import type { UserLinks } from '../../src/core/user-links';
import { ActionInputError } from '../../src/core/widget';

const loadConfig = createConfigLoader(path.resolve('tests/fixtures/preferences-config'), registry);
const PINGSHAN = { label: '坪山', latitude: 22.69, longitude: 114.33 };

let dir: string;
let file: string;
// 默认不读任何账号的导航文件；需要时在用例里换成自己的
let readLinks = async (_user: string): Promise<UserLinks | undefined> => undefined;
const service = () => createPreferencesService({ store: createPreferencesStore(() => file), registry, loadConfig, readLinks });
const onDisk = async () => JSON.parse(await readFile(file, 'utf8')) as unknown;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'home-preferences-'));
  file = path.join(dir, 'preferences.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  readLinks = async () => undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('preferencesFilePath', () => {
  it('reads PREFERENCES_FILE, falling back to data/preferences.json', () => {
    expect(preferencesFilePath({})).toBe(path.resolve(DEFAULT_PREFERENCES_FILE));
    expect(preferencesFilePath({ PREFERENCES_FILE: 'secrets/prefs.json' })).toBe(path.resolve('secrets/prefs.json'));
  });
});

describe('preferences service', () => {
  it('saves per user and merges patches into what was there', async () => {
    const prefs = service();
    await prefs.update('alice', { weather: PINGSHAN });
    await expect(prefs.update('alice', { steam: { count: 6 } })).resolves.toEqual({ weather: PINGSHAN, steam: { count: 6 } });
    await prefs.update('bob', { steam: { count: 1 } });

    expect(await onDisk()).toEqual({ alice: { weather: PINGSHAN, steam: { count: 6 } }, bob: { steam: { count: 1 } } });
    await expect(prefs.read('alice')).resolves.toEqual({ weather: PINGSHAN, steam: { count: 6 } });
  });

  it('removes the user entry once every preference is back to default', async () => {
    const prefs = service();
    await prefs.update('alice', { steam: { count: 6 } });
    await prefs.update('alice', { steam: null });
    expect(await onDisk()).toEqual({});
  });

  it('serializes concurrent saves so neither overwrites the other', async () => {
    const prefs = service();
    await Promise.all([prefs.update('alice', { weather: PINGSHAN }), prefs.update('alice', { steam: { count: 6 } })]);
    await expect(prefs.read('alice')).resolves.toEqual({ weather: PINGSHAN, steam: { count: 6 } });
  });

  it('rejects invalid patches and anonymous users without writing anything', async () => {
    const prefs = service();
    await expect(prefs.update('alice', { steam: { count: 0 } })).rejects.toThrow(ActionInputError);
    await expect(prefs.update(ANONYMOUS, { steam: { count: 6 } })).rejects.toThrow('未登录，无法保存设置');
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps entries it cannot read today but hides them from read', async () => {
    await writeFile(file, JSON.stringify({ alice: { retired: { x: 1 } } }), 'utf8');
    const prefs = service();
    await expect(prefs.read('alice')).resolves.toEqual({});
    await prefs.update('alice', { steam: { count: 6 } });
    expect(await onDisk()).toEqual({ alice: { retired: { x: 1 }, steam: { count: 6 } } });
  });

  it('builds the config with the user preferences merged in, and leaves others on the defaults', async () => {
    const prefs = service();
    await prefs.update('alice', { weather: PINGSHAN });
    expect(findWidget((await prefs.configFor('alice')).layout, 'weather')?.options).toEqual(PINGSHAN);
    expect(await prefs.configFor('bob')).toBe(await loadConfig());
    expect(await prefs.configFor(ANONYMOUS)).toBe(await loadConfig());
  });

  it('falls back to the default config when the preferences file is unreadable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await writeFile(file, '[]', 'utf8');
    await expect(service().configFor('alice')).resolves.toBe(await loadConfig());
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('configFor with an account navigation', () => {
  it("swaps in the account's own links for every consumer", async () => {
    readLinks = async (user) => (user === 'alice' ? { categories: [{ name: '工具', links: [{ name: '翻译', url: 'https://fanyi.example/' }] }] } : undefined);
    const prefs = service();

    const alice = await prefs.configFor('alice');
    expect(alice.links.categories.map((category) => category.name)).toEqual(['工具']);
    expect(alice.links.links.map((link) => link.url)).toEqual(['https://fanyi.example/']);
    expect((await prefs.configFor('bob')).links).toEqual((await loadConfig()).links);
  });

  it('falls back to links.yaml when the navigation cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    readLinks = async () => {
      throw new Error('disk');
    };
    expect((await service().configFor('alice')).links).toEqual((await loadConfig()).links);
  });
});
