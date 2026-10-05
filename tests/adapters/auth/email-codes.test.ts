import { beforeEach, describe, expect, it } from 'vitest';
import { CODE_TTL_MS, RESEND_COOLDOWN_MS, createCodeStore, type CodeStore } from '../../../src/adapters/auth/email-codes';

const EMAIL = 'ken@example.com';

describe('createCodeStore', () => {
  let clock: number;
  let codes: CodeStore;

  beforeEach(() => {
    clock = 1_000_000;
    codes = createCodeStore({ dailyLimit: 100, now: () => clock });
  });

  function issued(purpose: 'signup' | 'reset' | 'email' = 'signup', key = EMAIL): string {
    const result = codes.issue(purpose, key);
    if (!result.ok) throw new Error(`没发出来：${result.reason}`);
    return result.code;
  }

  /** 和真码一定不一样的 6 位数 */
  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

  it('issues a 6-digit code that works exactly once', () => {
    const code = issued();
    expect(code).toMatch(/^\d{6}$/);
    expect(codes.consume('signup', EMAIL, code)).toBe(true);
    expect(codes.consume('signup', EMAIL, code)).toBe(false);
  });

  it('ignores surrounding whitespace in the submitted code', () => {
    const code = issued();
    expect(codes.consume('signup', EMAIL, ` ${code} `)).toBe(true);
  });

  it('rejects a wrong code but keeps the right one usable', () => {
    const code = issued();
    expect(codes.consume('signup', EMAIL, wrong(code))).toBe(false);
    expect(codes.consume('signup', EMAIL, '12345')).toBe(false);
    expect(codes.consume('signup', EMAIL, code)).toBe(true);
  });

  it('voids the code after 5 wrong attempts', () => {
    const code = issued();
    for (let i = 0; i < 5; i += 1) expect(codes.consume('signup', EMAIL, wrong(code))).toBe(false);
    expect(codes.consume('signup', EMAIL, code)).toBe(false);
  });

  it('expires after 10 minutes', () => {
    const code = issued();
    clock += CODE_TTL_MS;
    expect(codes.consume('signup', EMAIL, code)).toBe(false);
  });

  it('keeps purposes and keys apart', () => {
    const code = issued('signup');
    expect(codes.consume('reset', EMAIL, code)).toBe(false);
    expect(codes.consume('signup', 'other@example.com', code)).toBe(false);
    expect(codes.consume('signup', EMAIL, code)).toBe(true);
  });

  it('does nothing for a key that never got a code', () => {
    expect(codes.consume('signup', EMAIL, '000000')).toBe(false);
  });

  it('refuses to resend within the cooldown, then replaces the old code', () => {
    const first = issued();
    expect(codes.issue('signup', EMAIL)).toEqual({ ok: false, reason: 'cooldown' });
    clock += RESEND_COOLDOWN_MS;
    const second = issued();
    if (first !== second) expect(codes.consume('signup', EMAIL, first)).toBe(false);
    expect(codes.consume('signup', EMAIL, second)).toBe(true);
  });

  it('allows at most 5 sends per key per hour', () => {
    for (let i = 0; i < 5; i += 1) {
      issued();
      clock += RESEND_COOLDOWN_MS;
    }
    expect(codes.issue('signup', EMAIL)).toEqual({ ok: false, reason: 'quota' });
    expect(codes.issue('signup', 'other@example.com').ok).toBe(true);
    clock += 60 * 60_000;
    expect(codes.issue('signup', EMAIL).ok).toBe(true);
  });

  it('stops sending site-wide once the daily limit is hit, until the next day', () => {
    codes = createCodeStore({ dailyLimit: 2, now: () => clock });
    issued('signup', 'a@example.com');
    issued('reset', 'b@example.com');
    expect(codes.issue('email', 'c@example.com')).toEqual({ ok: false, reason: 'daily' });
    clock += 24 * 60 * 60_000;
    expect(codes.issue('email', 'c@example.com').ok).toBe(true);
  });
});
