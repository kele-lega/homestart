import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AVATAR_FILE, AvatarInputError, avatarsDir, createAvatarFiles, MAX_AVATAR_BYTES } from '../../src/adapters/avatars';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const text = (value: string) => new TextEncoder().encode(value);

let dir: string;
const files = () => createAvatarFiles(() => dir);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'home-avatars-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('avatarsDir', () => {
  it('defaults to data/avatars and follows AVATARS_DIR', () => {
    expect(avatarsDir({})).toMatch(/data[/\\]avatars$/);
    expect(avatarsDir({ AVATARS_DIR: '/srv/avatars' })).toBe('/srv/avatars');
  });
});

describe('avatar files', () => {
  it('saves under a hashed name, privately, and reads it back', async () => {
    const avatars = files();
    const name = await avatars.save(2, PNG);
    expect(name).toMatch(AVATAR_FILE);
    expect(name.endsWith('.png')).toBe(true);
    expect(await avatars.read(name)).toEqual({ bytes: Buffer.from(PNG), type: 'png' });
    expect((await stat(path.join(dir, name))).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual([name]);
  });

  it('names the same picture differently for different accounts', async () => {
    const avatars = files();
    const alice = await avatars.save(2, PNG);
    const bob = await avatars.save(3, PNG);
    expect(alice).not.toBe(bob);
    expect(await avatars.save(2, PNG)).toBe(alice);
    expect((await readdir(dir)).sort()).toEqual([alice, bob].sort());
  });

  it('removes a file and ignores missing or malformed names', async () => {
    const avatars = files();
    const name = await avatars.save(2, PNG);
    await avatars.remove(name);
    expect(await avatars.read(name)).toBeUndefined();
    await expect(avatars.remove(name)).resolves.toBeUndefined();
    await expect(avatars.remove('../auth.db')).resolves.toBeUndefined();
  });

  it('refuses names outside the hash pattern when reading', async () => {
    expect(await files().read('../auth.db')).toBeUndefined();
    expect(await files().read('0123456789abcdef0123456789abcdef.svg')).toBeUndefined();
  });

  it('rejects empty, oversized and non-image uploads', async () => {
    const avatars = files();
    await expect(avatars.save(2, new Uint8Array())).rejects.toThrow(AvatarInputError);
    const huge = new Uint8Array(MAX_AVATAR_BYTES + 1);
    huge.set(PNG);
    await expect(avatars.save(2, huge)).rejects.toThrow('图片太大');
    await expect(avatars.save(2, text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).rejects.toThrow('只支持');
    await expect(avatars.save(2, Uint8Array.from([0, 0, 1, 0, 1, 0]))).rejects.toThrow('只支持');
    expect(await readdir(dir)).toEqual([]);
  });
});
