import { describe, expect, it } from 'vitest';
import { createSessionStore } from '../../../src/adapters/auth/session';

const DATA = { userId: 1, username: 'alice', role: 'user' as const };

describe('createSessionStore', () => {
  it('creates a session and reads it back', () => {
    const store = createSessionStore();
    const id = store.create(DATA);
    expect(store.read(id)).toEqual(DATA);
  });

  it('returns unpredictable ids', () => {
    const store = createSessionStore();
    const a = store.create(DATA);
    const b = store.create(DATA);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
  });

  it('returns undefined for an unknown id', () => {
    const store = createSessionStore();
    expect(store.read('does-not-exist')).toBeUndefined();
  });

  it('expires sessions after the TTL', () => {
    let time = 0;
    const store = createSessionStore({ now: () => time });
    const id = store.create(DATA);
    time = 31 * 24 * 3_600_000;
    expect(store.read(id)).toBeUndefined();
  });

  it('renews the TTL on read', () => {
    let time = 0;
    const store = createSessionStore({ now: () => time });
    const id = store.create(DATA);
    time = 29 * 24 * 3_600_000;
    expect(store.read(id)).toEqual(DATA);
    time = 29 * 24 * 3_600_000 + 29 * 24 * 3_600_000;
    expect(store.read(id)).toEqual(DATA);
  });

  it('destroys a session', () => {
    const store = createSessionStore();
    const id = store.create(DATA);
    store.destroy(id);
    expect(store.read(id)).toBeUndefined();
  });

  it('destroying an unknown id does not throw', () => {
    const store = createSessionStore();
    expect(() => store.destroy('nope')).not.toThrow();
  });
});
