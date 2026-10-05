import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSuggestionsService, SuggestionsStoreError } from '../../src/adapters/suggestions';
import { SUGGESTION_LIMITS } from '../../src/lib/suggestions';

vi.mock('../../src/core/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/log')>()),
  logBackgroundError: vi.fn(),
}));

let dir: string;
let file: string;
let clock: number;
let ids: number;

const ALICE = { username: 'alice', author: '爱丽丝' };
const service = () =>
  createSuggestionsService({
    filePath: () => file,
    now: () => clock++,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'suggestions-'));
  file = path.join(dir, 'nested', 'suggestions.json');
  clock = 1000;
  ids = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('suggestions store', () => {
  it('reads a missing file as no suggestions', async () => {
    expect(await service().list()).toEqual([]);
  });

  it('stores submissions newest first with author and time, in a private file', async () => {
    const store = service();
    await store.submit({ body: '一' }, ALICE);
    await store.submit({ body: '二' }, { username: 'bob', author: 'bob' });
    const list = await store.list();

    expect(list.map((item) => item.body)).toEqual(['二', '一']);
    expect(list[1]).toMatchObject({ username: 'alice', author: '爱丽丝', createdAt: 1000, done: false });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(list);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('marks and removes by id', async () => {
    const store = service();
    await store.submit({ body: '一' }, ALICE);
    await store.submit({ body: '二' }, ALICE);
    const [second, first] = await store.list();

    expect((await store.mark(first!.id, true)).map((item) => item.done)).toEqual([false, true]);
    expect(await store.remove(second!.id)).toEqual([{ ...first!, done: true }]);
    expect(await store.remove('00000000-0000-4000-8000-999999999999')).toHaveLength(1);
  });

  it('keeps concurrent submissions', async () => {
    const store = service();
    await Promise.all(Array.from({ length: 10 }, (_, index) => store.submit({ body: String(index) }, ALICE)));
    expect(await store.list()).toHaveLength(10);
  });

  it('drops the oldest past the limit', async () => {
    const old = Array.from({ length: SUGGESTION_LIMITS.count }, (_, index) => ({
      id: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
      body: 'x',
      username: 'a',
      author: 'a',
      createdAt: index,
      done: false,
    }));
    await writeFile(path.join(dir, 'full.json'), JSON.stringify(old));
    file = path.join(dir, 'full.json');
    const store = service();
    await store.submit({ body: '新的' }, ALICE);
    const list = await store.list();

    expect(list).toHaveLength(SUGGESTION_LIMITS.count);
    expect(list[0]!.body).toBe('新的');
    expect(list.some((item) => item.createdAt === 0)).toBe(false);
  });

  it('shows an unreadable file as empty and refuses to overwrite it', async () => {
    file = path.join(dir, 'broken.json');
    await writeFile(file, '{ "oops": true }');
    const store = service();

    expect(await store.list()).toEqual([]);
    await expect(store.submit({ body: '一' }, ALICE)).rejects.toBeInstanceOf(SuggestionsStoreError);
    expect(await readFile(file, 'utf8')).toBe('{ "oops": true }');
  });
});
