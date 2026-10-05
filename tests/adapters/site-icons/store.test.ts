import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIconStore, IconInputError, MAX_ICON_BYTES, sniffIcon } from '../../../src/adapters/site-icons/store';

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const text = (value: string) => new TextEncoder().encode(value);

let dir: string;
const store = () => createIconStore(() => dir);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'home-site-icons-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('sniffIcon', () => {
  it('recognizes images by their first bytes, not by name', () => {
    expect(sniffIcon(PNG)).toBe('png');
    expect(sniffIcon(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffIcon(text('GIF89a'))).toBe('gif');
    expect(sniffIcon(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffIcon(Uint8Array.from([0, 0, 1, 0, 1, 0]))).toBe('ico');
    expect(sniffIcon(text('﻿<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
  });

  it('rejects anything else, including HTML pretending to be an icon', () => {
    expect(sniffIcon(text('<!doctype html><html><svg></svg></html>'))).toBeUndefined();
    expect(sniffIcon(Uint8Array.from([0, 0, 1, 0, 0, 0]))).toBeUndefined();
    expect(sniffIcon(new Uint8Array())).toBeUndefined();
  });
});

describe('icon store', () => {
  it('stores by content hash, once, and reads it back', async () => {
    const icons = store();
    const first = await icons.save(PNG);
    expect(first).toMatch(/^\/site-icons\/[0-9a-f]{32}\.png$/);
    expect(await icons.save(PNG)).toBe(first);
    expect(await readdir(dir)).toHaveLength(1);

    const read = await icons.read(first.slice('/site-icons/'.length));
    expect(read?.type).toBe('png');
    expect(new Uint8Array(read!.bytes)).toEqual(PNG);
  });

  it('refuses empty, oversized and unknown files', async () => {
    await expect(store().save(new Uint8Array())).rejects.toThrow(IconInputError);
    const big = new Uint8Array(MAX_ICON_BYTES + 1);
    big.set(PNG);
    await expect(store().save(big)).rejects.toThrow('图片太大');
    await expect(store().save(text('hello'))).rejects.toThrow('只支持');
  });

  it('only reads well-formed names inside its directory', async () => {
    await expect(store().read('../../etc/passwd')).resolves.toBeUndefined();
    await expect(store().read('0123456789abcdef0123456789abcdef.exe')).resolves.toBeUndefined();
    await expect(store().read('0123456789abcdef0123456789abcdef.png')).resolves.toBeUndefined();
  });
});
