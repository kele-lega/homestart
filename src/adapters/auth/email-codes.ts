/**
 * 邮件验证码：6 位数字，10 分钟内有效，用一次就作废，输错 5 次也作废。
 * 同一个用途 + 邮箱 60 秒内只发一次、一小时最多 5 次；全站每天的发信总数另有上限（Resend 免费额度）。
 * 只放在内存里：服务重启后没用掉的码全部失效，重新发一次就是，不值得为它落库
 */
import { randomInt, timingSafeEqual } from 'node:crypto';

export type CodePurpose = 'signup' | 'reset' | 'email';

export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_COOLDOWN_MS = 60_000;
const SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** 跟踪的邮箱数上限，超出时丢掉最早的，内存不会被灌爆 */
const MAX_ENTRIES = 5000;

export type IssueResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: 'cooldown' | 'quota' | 'daily' };

export interface CodeStore {
  /** 发新码（同一个 key 原来的码作废）；太频繁或今天发满了返回原因，不发 */
  issue(purpose: CodePurpose, key: string): IssueResult;
  /** 对了就作废这个码并返回 true；错了记一次，错满 5 次作废 */
  consume(purpose: CodePurpose, key: string, code: string): boolean;
}

interface Entry {
  code: string | null;
  expiresAt: number;
  attempts: number;
  /** 最近一小时内的发送时间 */
  sends: number[];
}

export function createCodeStore({ dailyLimit, now = () => Date.now() }: { dailyLimit: number; now?: () => number }): CodeStore {
  const entries = new Map<string, Entry>();
  let day = { start: 0, sent: 0 };

  const id = (purpose: CodePurpose, key: string) => `${purpose}:${key}`;

  return {
    issue(purpose, key) {
      const at = now();
      const entry = entries.get(id(purpose, key)) ?? { code: null, expiresAt: 0, attempts: 0, sends: [] };
      entry.sends = entry.sends.filter((sent) => at - sent < HOUR_MS);
      const last = entry.sends.at(-1);
      if (last !== undefined && at - last < RESEND_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
      if (entry.sends.length >= SENDS_PER_HOUR) return { ok: false, reason: 'quota' };
      if (at - day.start >= DAY_MS) day = { start: at, sent: 0 };
      if (day.sent >= dailyLimit) return { ok: false, reason: 'daily' };

      day.sent += 1;
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      Object.assign(entry, { code, expiresAt: at + CODE_TTL_MS, attempts: 0 });
      entry.sends.push(at);
      // 重新插入，Map 的顺序就是「最近用到」的顺序
      entries.delete(id(purpose, key));
      entries.set(id(purpose, key), entry);
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
      return { ok: true, code };
    },
    consume(purpose, key, code) {
      const entry = entries.get(id(purpose, key));
      if (!entry?.code || now() >= entry.expiresAt) return false;
      const given = Buffer.from(code.trim());
      const expected = Buffer.from(entry.code);
      if (given.length === expected.length && timingSafeEqual(given, expected)) {
        entry.code = null;
        return true;
      }
      entry.attempts += 1;
      if (entry.attempts >= MAX_ATTEMPTS) entry.code = null;
      return false;
    },
  };
}
