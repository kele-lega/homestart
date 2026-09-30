import { beforeEach, describe, expect, it } from 'vitest';
import { AuthInputError, createAuthStore, ensureInitialAdmin, normalizeUsername, type AuthStore } from '../../../src/adapters/auth/store';

describe('normalizeUsername', () => {
  it('lowercases and trims', () => {
    expect(normalizeUsername('  Alice  ')).toBe('alice');
  });

  it('rejects invalid characters', () => {
    expect(() => normalizeUsername('a b')).toThrow(AuthInputError);
    expect(() => normalizeUsername('')).toThrow(AuthInputError);
  });
});

describe('createAuthStore', () => {
  let store: AuthStore;

  beforeEach(() => {
    store = createAuthStore({ filePath: ':memory:' });
  });

  it('creates and finds a user by username, case-insensitively', () => {
    store.createUser('Bob', 'hash', 'user');
    expect(store.findByUsername('bob')?.username).toBe('bob');
    expect(store.findByUsername('BOB')?.username).toBe('bob');
  });

  it('finds a user by id', () => {
    const created = store.createUser('carol', 'hash', 'admin');
    expect(store.findById(created.id)?.role).toBe('admin');
  });

  it('returns undefined for unknown users', () => {
    expect(store.findByUsername('nobody')).toBeUndefined();
    expect(store.findById(999)).toBeUndefined();
  });

  it('rejects duplicate usernames', () => {
    store.createUser('dave', 'hash', 'user');
    expect(() => store.createUser('dave', 'other', 'user')).toThrow();
  });

  it('lists users without exposing password hashes', () => {
    store.createUser('eve', 'secret-hash', 'user');
    const list = store.listUsers();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('passwordHash');
    expect(list[0]!.username).toBe('eve');
  });

  it('updates a password hash', () => {
    const created = store.createUser('frank', 'old-hash', 'user');
    store.updatePassword(created.id, 'new-hash');
    expect(store.findById(created.id)?.passwordHash).toBe('new-hash');
  });

  it('deletes a user', () => {
    const created = store.createUser('grace', 'hash', 'user');
    store.deleteUser(created.id);
    expect(store.findById(created.id)).toBeUndefined();
  });
});

describe('ensureInitialAdmin', () => {
  let store: AuthStore;

  beforeEach(() => {
    store = createAuthStore({ filePath: ':memory:' });
  });

  it('creates the admin when the table is empty and env vars are set', async () => {
    await ensureInitialAdmin(store, { INITIAL_ADMIN_USER: 'root', INITIAL_ADMIN_PASSWORD: 'hunter2' } as NodeJS.ProcessEnv);
    const admin = store.findByUsername('root');
    expect(admin?.role).toBe('admin');
    expect(admin?.passwordHash).not.toBe('hunter2');
  });

  it('does nothing when env vars are missing', async () => {
    await ensureInitialAdmin(store, {} as NodeJS.ProcessEnv);
    expect(store.listUsers()).toHaveLength(0);
  });

  it('does nothing when users already exist', async () => {
    store.createUser('existing', 'hash', 'user');
    await ensureInitialAdmin(store, { INITIAL_ADMIN_USER: 'root', INITIAL_ADMIN_PASSWORD: 'hunter2' } as NodeJS.ProcessEnv);
    expect(store.findByUsername('root')).toBeUndefined();
  });
});
