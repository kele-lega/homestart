import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcementsFilePath, AnnouncementsStoreError, createAnnouncementsService } from '../../src/adapters/announcements';

vi.mock('../../src/core/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/log')>()),
  logBackgroundError: vi.fn(),
}));

let dir: string;
let file: string;
let clock: number;
let ids: number;

const service = () =>
  createAnnouncementsService({
    filePath: () => file,
    now: () => clock++,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'announcements-'));
  file = path.join(dir, 'nested', 'announcements.json');
  clock = 1000;
  ids = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('announcements store', () => {
  it('reads a missing file as no announcements', async () => {
    expect(await service().list()).toEqual([]);
  });

  it('publishes newest first, stamps time and author, and writes a private file', async () => {
    const store = service();
    await store.publish({ title: '一', body: '' }, '小可乐');
    const list = await store.publish({ title: '二', body: '正文' }, 'root');

    expect(list.map((a) => a.title)).toEqual(['二', '一']);
    expect(list[0]).toMatchObject({ body: '正文', author: 'root', createdAt: 1001 });
    expect(await store.list()).toEqual(list);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(list);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('removes by id and treats an id that is already gone as removed', async () => {
    const store = service();
    const [first] = await store.publish({ title: '一', body: '' }, 'root');
    await store.publish({ title: '二', body: '' }, 'root');

    expect((await store.remove(first!.id)).map((a) => a.title)).toEqual(['二']);
    expect((await store.remove(first!.id)).map((a) => a.title)).toEqual(['二']);
  });

  it('does not lose either of two publishes that race', async () => {
    const store = service();
    await Promise.all([store.publish({ title: '甲', body: '' }, 'a'), store.publish({ title: '乙', body: '' }, 'b')]);
    expect((await store.list()).map((a) => a.title).sort()).toEqual(['乙', '甲'].sort());
  });

  it('shows no announcements for a broken file but refuses to overwrite it', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ not json', 'utf8');
    const store = service();

    expect(await store.list()).toEqual([]);
    await expect(store.publish({ title: '一', body: '' }, 'root')).rejects.toBeInstanceOf(AnnouncementsStoreError);
    expect(await readFile(file, 'utf8')).toBe('{ not json');
  });

  it('takes the path from ANNOUNCEMENTS_FILE, defaulting to data/announcements.json', () => {
    expect(announcementsFilePath({ ANNOUNCEMENTS_FILE: '/srv/a.json' })).toBe(path.resolve('/srv/a.json'));
    expect(announcementsFilePath({})).toBe(path.resolve('data/announcements.json'));
  });
});
