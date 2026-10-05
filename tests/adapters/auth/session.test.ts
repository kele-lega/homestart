import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { openAuthDb } from '../../../src/adapters/auth/db';
import {
  IDLE_TTL_MS,
  MAX_SESSIONS_PER_USER,
  REMEMBER_TTL_MS,
  createSessionStore,
  type SessionStore,
} from '../../../src/adapters/auth/session';
import { createAuthStore, type AuthStore } from '../../../src/adapters/auth/store';

const MINUTE = 60_000;

describe('createSessionStore', () => {
  let db: DatabaseSync;
  let users: AuthStore;
  let sessions: SessionStore;
  let time: number;
  let alice: number;
  let bob: number;

  beforeEach(() => {
    db = openAuthDb(':memory:');
    users = createAuthStore({ db });
    time = 1_000_000;
    sessions = createSessionStore({ db, now: () => time });
    alice = users.createUser('alice', 'h', 'user').id;
    bob = users.createUser('bob', 'h', 'admin').id;
  });

  it('issues an unpredictable token and resolves it to the joined user', () => {
    const { token, sessionId } = sessions.create({ userId: alice, remember: false });
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(sessions.resolve(token)).toEqual({ sessionId, userId: alice, username: 'alice', displayName: null, role: 'user' });
  });

  it('stores only a hash of the token', () => {
    const { token } = sessions.create({ userId: alice, remember: false });
    const stored = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).not.toBe(token);
    expect(JSON.stringify(db.prepare('SELECT * FROM sessions').all())).not.toContain(token);
  });

  it('ignores unknown, empty and oversized tokens', () => {
    sessions.create({ userId: alice, remember: false });
    expect(sessions.resolve('nope')).toBeUndefined();
    expect(sessions.resolve('')).toBeUndefined();
    expect(sessions.resolve('x'.repeat(200))).toBeUndefined();
  });

  it('reflects display name and role changes immediately', () => {
    const { token } = sessions.create({ userId: alice, remember: true });
    users.updateDisplayName(alice, '爱丽丝');
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(alice);
    expect(sessions.resolve(token)).toMatchObject({ displayName: '爱丽丝', role: 'admin' });
  });

  describe('remember me', () => {
    it('keeps a remembered session for 30 days from login, however active it is', () => {
      const { token } = sessions.create({ userId: alice, remember: true });
      time += REMEMBER_TTL_MS - MINUTE;
      expect(sessions.resolve(token)).toBeDefined();
      time += MINUTE;
      expect(sessions.resolve(token)).toBeUndefined();
    });

    it('expires a session that is not remembered after 12 idle hours', () => {
      const { token } = sessions.create({ userId: alice, remember: false });
      time += IDLE_TTL_MS;
      expect(sessions.resolve(token)).toBeUndefined();
    });

    it('slides the idle expiry forward while the session is being used', () => {
      const { token } = sessions.create({ userId: alice, remember: false });
      for (let hour = 0; hour < 30; hour += 1) {
        time += IDLE_TTL_MS / 2;
        expect(sessions.resolve(token), `after ${hour} half-days`).toBeDefined();
      }
    });
  });

  it('writes last-seen at most once a minute', () => {
    const { token, sessionId } = sessions.create({ userId: alice, remember: true });
    const lastSeen = () => sessions.list(alice).find((row) => row.id === sessionId)!.lastSeenAt;
    time += 30_000;
    sessions.resolve(token);
    expect(lastSeen()).toBe(1_000_000);
    time += 30_000;
    sessions.resolve(token);
    expect(lastSeen()).toBe(1_060_000);
  });

  it('deletes an expired session when it is looked up', () => {
    const { token } = sessions.create({ userId: alice, remember: false });
    time += IDLE_TTL_MS + 1;
    sessions.resolve(token);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('destroys a session by token', () => {
    const { token } = sessions.create({ userId: alice, remember: true });
    sessions.destroy(token);
    expect(sessions.resolve(token)).toBeUndefined();
  });

  it('lists only live sessions of that user, most recently used first, with device details', () => {
    const first = sessions.create({ userId: alice, remember: true, userAgent: 'UA-1', ip: '203.0.113.1' });
    time += MINUTE;
    const second = sessions.create({ userId: alice, remember: false, userAgent: 'UA-2' });
    sessions.create({ userId: bob, remember: true });

    const list = sessions.list(alice);

    expect(list.map((row) => row.id)).toEqual([second.sessionId, first.sessionId]);
    expect(list[1]).toEqual({
      id: first.sessionId,
      userAgent: 'UA-1',
      ip: '203.0.113.1',
      remember: true,
      createdAt: 1_000_000,
      lastSeenAt: 1_000_000,
      expiresAt: 1_000_000 + REMEMBER_TTL_MS,
    });
  });

  it('truncates very long user agents', () => {
    sessions.create({ userId: alice, remember: true, userAgent: 'x'.repeat(1000) });
    expect(sessions.list(alice)[0]!.userAgent).toHaveLength(256);
  });

  it('revokes one session only when it belongs to that user', () => {
    const own = sessions.create({ userId: alice, remember: true });
    const other = sessions.create({ userId: bob, remember: true });
    expect(sessions.revoke(alice, other.sessionId)).toBe(0);
    expect(sessions.resolve(other.token)).toBeDefined();
    expect(sessions.revoke(alice, own.sessionId)).toBe(1);
    expect(sessions.resolve(own.token)).toBeUndefined();
  });

  it('revokes every other session of the user, keeping the given one and other users', () => {
    const keep = sessions.create({ userId: alice, remember: true });
    const drop = sessions.create({ userId: alice, remember: false });
    const bobs = sessions.create({ userId: bob, remember: true });

    expect(sessions.revokeOthers(alice, keep.sessionId)).toBe(1);

    expect(sessions.resolve(keep.token)).toBeDefined();
    expect(sessions.resolve(drop.token)).toBeUndefined();
    expect(sessions.resolve(bobs.token)).toBeDefined();
  });

  it('revokes all sessions of the user', () => {
    sessions.create({ userId: alice, remember: true });
    sessions.create({ userId: alice, remember: false });
    expect(sessions.revokeAll(alice)).toBe(2);
    expect(sessions.list(alice)).toEqual([]);
  });

  it('keeps at most MAX_SESSIONS_PER_USER sessions, dropping the least recently used', () => {
    const tokens = Array.from({ length: MAX_SESSIONS_PER_USER + 3 }, () => {
      time += MINUTE;
      return sessions.create({ userId: alice, remember: true }).token;
    });
    expect(sessions.list(alice)).toHaveLength(MAX_SESSIONS_PER_USER);
    expect(sessions.resolve(tokens[0]!)).toBeUndefined();
    expect(sessions.resolve(tokens.at(-1)!)).toBeDefined();
  });

  it('removes sessions together with their user', () => {
    const { token } = sessions.create({ userId: alice, remember: true });
    users.deleteUser(alice);
    expect(sessions.resolve(token)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
});
