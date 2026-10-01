import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, authDbFilePath, openAuthDb } from '../../../src/adapters/auth/db';
import { createAuthStore } from '../../../src/adapters/auth/store';

const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);

describe('authDbFilePath', () => {
  it('keeps :memory: literal instead of resolving it as a file name', () => {
    expect(authDbFilePath({ AUTH_DB_FILE: ':memory:' } as NodeJS.ProcessEnv)).toBe(':memory:');
  });

  it('defaults to data/auth.db under the working directory', () => {
    expect(authDbFilePath({} as NodeJS.ProcessEnv)).toBe(path.resolve('data/auth.db'));
  });
});

describe('openAuthDb', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('creates the full schema on a fresh database', () => {
    const db = openAuthDb(':memory:');
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(tables(db)).toEqual(expect.arrayContaining(['sessions', 'users']));
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it('upgrades a database created before sessions and display names existed, keeping its users', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'auth-db-'));
    const file = path.join(dir, 'auth.db');
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')), created_at INTEGER NOT NULL)`);
    legacy.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run('old', 'h', 'admin', 1);
    legacy.close();

    const db = openAuthDb(file);

    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(createAuthStore({ db }).findByUsername('old')).toMatchObject({ role: 'admin', displayName: null, lastLogin: null });
    db.close();
  });

  it('is idempotent when opened again', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'auth-db-'));
    const file = path.join(dir, 'auth.db');
    openAuthDb(file).close();
    const db = openAuthDb(file);
    expect(version(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('creates missing parent directories', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'auth-db-'));
    const file = path.join(dir, 'nested', 'deeper', 'auth.db');
    openAuthDb(file).close();
    expect(existsSync(file)).toBe(true);
  });
});
