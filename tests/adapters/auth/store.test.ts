import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuthInputError,
  createAuthStore,
  ensureInitialAdmin,
  normalizeDisplayName,
  normalizeUsername,
  type AuthStore,
} from '../../../src/adapters/auth/store';

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

  it('starts without a display name or login history', () => {
    const created = store.createUser('heidi', 'hash', 'user');
    expect(store.findById(created.id)).toMatchObject({ displayName: null, lastLogin: null, previousLogin: null });
  });

  it('sets and clears a display name', () => {
    const created = store.createUser('ivan', 'hash', 'user');
    store.updateDisplayName(created.id, '伊万');
    expect(store.findById(created.id)?.displayName).toBe('伊万');
    store.updateDisplayName(created.id, null);
    expect(store.findById(created.id)?.displayName).toBeNull();
  });

  it('shifts the latest login into previousLogin when a new one is recorded', () => {
    const created = store.createUser('judy', 'hash', 'user');
    store.recordLogin(created.id, { at: 1000, ip: '203.0.113.5' });
    expect(store.findById(created.id)).toMatchObject({ lastLogin: { at: 1000, ip: '203.0.113.5' }, previousLogin: null });

    store.recordLogin(created.id, { at: 2000, ip: null });

    expect(store.findById(created.id)).toMatchObject({
      lastLogin: { at: 2000, ip: null },
      previousLogin: { at: 1000, ip: '203.0.113.5' },
    });
  });

  it('lists the latest login but never the password hash or previous login', () => {
    const created = store.createUser('ken', 'hash', 'user');
    store.recordLogin(created.id, { at: 5000, ip: '198.51.100.7' });
    const [row] = store.listUsers();
    expect(row).toEqual({
      id: created.id,
      username: 'ken',
      displayName: null,
      role: 'user',
      createdAt: created.createdAt,
      lastLogin: { at: 5000, ip: '198.51.100.7' },
    });
  });
});

describe('normalizeDisplayName', () => {
  it('trims and treats blank as no display name', () => {
    expect(normalizeDisplayName('  可乐  ')).toBe('可乐');
    expect(normalizeDisplayName('   ')).toBeNull();
  });

  it('counts characters rather than UTF-16 units', () => {
    expect(normalizeDisplayName('🌸'.repeat(32))).toBe('🌸'.repeat(32));
    expect(() => normalizeDisplayName('字'.repeat(33))).toThrow('昵称最多 32 个字');
  });

  it('rejects control, zero-width and bidi characters', () => {
    for (const code of [0x00, 0x1b, 0x200b, 0x202e, 0x2066, 0xfeff]) {
      expect(() => normalizeDisplayName(`a${String.fromCodePoint(code)}b`), code.toString(16)).toThrow(AuthInputError);
    }
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
