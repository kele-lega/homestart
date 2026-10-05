import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLinkVisitsService,
  createLinkVisitsStore,
  DEFAULT_LINK_VISITS_FILE,
  linkVisitsFilePath,
  MAX_VISITS,
  withVisit,
} from '../../src/adapters/link-visits';
import { ANONYMOUS } from '../../src/core/api';

let dir: string;
let file: string;
const service = () => createLinkVisitsService(createLinkVisitsStore(() => file));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'home-link-visits-'));
  file = path.join(dir, 'link-visits.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('linkVisitsFilePath', () => {
  it('reads LINK_VISITS_FILE, falling back to data/link-visits.json', () => {
    expect(linkVisitsFilePath({})).toBe(path.resolve(DEFAULT_LINK_VISITS_FILE));
    expect(linkVisitsFilePath({ LINK_VISITS_FILE: 'x/visits.json' })).toBe(path.resolve('x/visits.json'));
  });
});

describe('withVisit', () => {
  it('moves the visited address to the front without duplicates and caps the list', () => {
    expect(withVisit(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    const full = Array.from({ length: MAX_VISITS }, (_, index) => String(index));
    expect(withVisit(full, 'new')).toHaveLength(MAX_VISITS);
    expect(withVisit(full, 'new')[0]).toBe('new');
  });
});

describe('link visits service', () => {
  it('keeps the most recent first, per user', async () => {
    const visits = service();
    await Promise.all([visits.record('alice', 'https://a/'), visits.record('alice', 'https://b/'), visits.record('bob', 'https://a/')]);
    await visits.record('alice', 'https://a/');

    await expect(visits.recent('alice')).resolves.toEqual(['https://a/', 'https://b/']);
    await expect(visits.recent('bob')).resolves.toEqual(['https://a/']);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ alice: ['https://a/', 'https://b/'], bob: ['https://a/'] });
  });

  it('never reads or writes anything for anonymous visitors', async () => {
    const visits = service();
    await visits.record(ANONYMOUS, 'https://a/');

    await expect(visits.recent(ANONYMOUS)).resolves.toEqual([]);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('reads entries that are not lists as no visits and drops non-string items', async () => {
    await writeFile(file, JSON.stringify({ alice: 'oops', bob: ['https://a/', 3, null] }));

    await expect(service().recent('alice')).resolves.toEqual([]);
    await expect(service().recent('bob')).resolves.toEqual(['https://a/']);
  });
});
