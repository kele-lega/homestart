import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSteamStore, DEFAULT_STEAM_USERS_FILE, SteamStoreError, steamUsersFilePath } from '../../../src/adapters/steam/store';

// 读写规则与日历设置共用（tests/adapters/calendar/store.test.ts 覆盖），这里只测 Steam 自己的部分
let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'steam-store-'));
  file = path.join(dir, 'steam-users.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const store = () => createSteamStore({ filePath: () => file });
const ID = '76561198000000001';

describe('steamUsersFilePath', () => {
  it.each([
    [{}, path.resolve(DEFAULT_STEAM_USERS_FILE)],
    [{ STEAM_USERS_FILE: ' ' }, path.resolve(DEFAULT_STEAM_USERS_FILE)],
    [{ STEAM_USERS_FILE: 'secrets/steam.json' }, path.resolve('secrets/steam.json')],
  ])('%o → %s', (env, expected) => {
    // Act + Assert
    expect(steamUsersFilePath(env)).toBe(expected);
  });

  it('默认的存储按环境变量取路径', async () => {
    // Arrange
    vi.stubEnv('STEAM_USERS_FILE', file);

    // Act
    await createSteamStore().put('alice', ID);

    // Assert
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ alice: ID });
  });
});

describe('createSteamStore', () => {
  it('保存后读回 SteamID64；不是个人账号 SteamID64 的条目读作未绑定', async () => {
    // Arrange
    await writeFile(file, JSON.stringify({ bob: '76561197960265728', carol: 76561198000000001, dave: 'gabe' }), 'utf8');
    const users = store();

    // Act
    await users.put('alice', ID);

    // Assert
    expect(await users.get('alice')).toBe(ID);
    expect(await Promise.all(['bob', 'carol', 'dave'].map((user) => users.get(user)))).toEqual([undefined, undefined, undefined]);
  });

  it('文件格式有误：读作未绑定、日志说明是 Steam 设置；拒绝写入', async () => {
    // Arrange
    await mkdir(dir, { recursive: true });
    await writeFile(file, '[]', 'utf8');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    const read = await store().get('alice');
    const write = store().put('alice', ID);

    // Assert
    expect(read).toBeUndefined();
    await expect(write).rejects.toBeInstanceOf(SteamStoreError);
    expect(String(log.mock.calls[0][0])).toMatch(/\[steam\].*Steam 设置文件格式有误/);
  });
});
