import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSiteStatsService, parseSiteCounts, siteStatsFilePath } from '../../src/adapters/site-stats';

vi.mock('../../src/core/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/log')>()),
  logBackgroundError: vi.fn(),
}));

const { logBackgroundError } = await import('../../src/core/log');

let dir: string;
let file: string;

const service = () => createSiteStatsService({ filePath: () => file });
const saved = async () => JSON.parse(await readFile(file, 'utf8')) as unknown;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'site-stats-'));
  file = path.join(dir, 'nested', 'site-stats.json');
  vi.mocked(logBackgroundError).mockReset();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('site stats store', () => {
  it('starts from zero without a file', async () => {
    expect(await service().counts()).toEqual({ nav: 0, search: 0 });
  });

  it('counts hits, returns the new totals and writes a private file', async () => {
    const stats = service();
    expect(await stats.hit('nav')).toEqual({ nav: 1, search: 0 });
    expect(await stats.hit('search')).toEqual({ nav: 1, search: 1 });
    await stats.flush();

    expect(await saved()).toEqual({ nav: 1, search: 1 });
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('continues from the saved numbers', async () => {
    await writeFile(path.join(dir, 'start.json'), JSON.stringify({ nav: 41, search: 7 }));
    file = path.join(dir, 'start.json');
    const stats = service();

    expect(await stats.hit('nav')).toEqual({ nav: 42, search: 7 });
    await stats.flush();
    expect(await saved()).toEqual({ nav: 42, search: 7 });
  });

  it('loses no hits when many arrive at once', async () => {
    const stats = service();
    await Promise.all(Array.from({ length: 50 }, (_, index) => stats.hit(index % 2 ? 'search' : 'nav')));
    await stats.flush();

    expect(await stats.counts()).toEqual({ nav: 25, search: 25 });
    expect(await saved()).toEqual({ nav: 25, search: 25 });
    // 新起一个服务（进程重启）读到的也是这些
    expect(await service().counts()).toEqual({ nav: 25, search: 25 });
  });

  it('never overwrites an unreadable file but keeps counting in memory', async () => {
    file = path.join(dir, 'broken.json');
    await writeFile(file, '{ not json');
    const stats = service();

    expect(await stats.hit('nav')).toEqual({ nav: 1, search: 0 });
    expect(await stats.hit('nav')).toEqual({ nav: 2, search: 0 });
    await stats.flush();

    expect(await readFile(file, 'utf8')).toBe('{ not json');
    expect(logBackgroundError).toHaveBeenCalledTimes(1);
  });

  it('tells subscribers about a burst of hits once, with the totals', async () => {
    vi.useFakeTimers();
    try {
      const stats = createSiteStatsService({ filePath: () => file, notifyMs: 100 });
      const heard: unknown[] = [];
      const stop = stats.subscribe((counts) => heard.push(counts));
      await stats.hit('nav');
      await stats.hit('search');
      await stats.hit('nav');
      expect(heard).toEqual([]);

      await vi.advanceTimersByTimeAsync(100);
      expect(heard).toEqual([{ nav: 2, search: 1 }]);

      stop();
      await stats.hit('nav');
      await vi.advanceTimersByTimeAsync(100);
      expect(heard).toHaveLength(1);
      await stats.flush();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps notifying the others when one subscriber throws', async () => {
    vi.useFakeTimers();
    try {
      const stats = createSiteStatsService({ filePath: () => file, notifyMs: 10 });
      const heard: unknown[] = [];
      stats.subscribe(() => {
        throw new Error('closed');
      });
      stats.subscribe((counts) => heard.push(counts));
      await stats.hit('search');
      await vi.advanceTimersByTimeAsync(10);
      expect(heard).toEqual([{ nav: 0, search: 1 }]);
      await stats.flush();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads bad fields as zero', () => {
    expect(parseSiteCounts({ nav: 3, search: -1 })).toEqual({ nav: 3, search: 0 });
    expect(parseSiteCounts({ nav: '3', search: 1.5 })).toEqual({ nav: 0, search: 0 });
    expect(parseSiteCounts([])).toBeUndefined();
    expect(parseSiteCounts(null)).toBeUndefined();
  });

  it('takes the file path from SITE_STATS_FILE', () => {
    expect(siteStatsFilePath({ SITE_STATS_FILE: '/srv/stats.json' })).toBe(path.resolve('/srv/stats.json'));
    expect(siteStatsFilePath({})).toBe(path.resolve('data/site-stats.json'));
  });
});
