/**
 * 第三方登录身份：一个账号最多绑一个 GitHub、一个 Google，一个第三方账号也只能绑到一个站内账号（表结构见 ./db.ts）。
 * subject 是对方给的稳定编号（GitHub 的数字 id、Google 的 sub），不随对方改名、改邮箱变化；
 * label 只用来在个人中心显示「绑的是哪一个」（GitHub 登录名、Google 邮箱），登录时按对方最新的值更新。
 * 第三方的访问令牌只在登录那一下用来取资料，从不落库
 */
import type { DatabaseSync } from 'node:sqlite';

export const PROVIDERS = ['github', 'google'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const isProvider = (value: string): value is Provider => (PROVIDERS as readonly string[]).includes(value);

export interface IdentityRecord {
  readonly userId: number;
  readonly provider: Provider;
  readonly subject: string;
  readonly label: string;
  readonly createdAt: number;
}

export interface IdentityStore {
  find(provider: Provider, subject: string): IdentityRecord | undefined;
  listByUser(userId: number): readonly IdentityRecord[];
  /** (provider, subject) 已经绑在别的账号上、或者这个账号已经绑了同一家时，库的唯一约束会抛错：调用方先查再写 */
  link(userId: number, provider: Provider, subject: string, label: string): void;
  updateLabel(provider: Provider, subject: string, label: string): void;
  /** 返回删掉了几条 */
  unlink(userId: number, provider: Provider): number;
}

type Row = Record<string, unknown>;

function toRecord(row: Row): IdentityRecord {
  return {
    userId: row.user_id as number,
    provider: row.provider as Provider,
    subject: row.subject as string,
    label: row.label as string,
    createdAt: row.created_at as number,
  };
}

export function createIdentityStore(db: DatabaseSync, now: () => number = () => Date.now()): IdentityStore {
  const bySubject = db.prepare('SELECT * FROM identities WHERE provider = ? AND subject = ?');
  const byUser = db.prepare('SELECT * FROM identities WHERE user_id = ? ORDER BY provider');
  const insert = db.prepare('INSERT INTO identities (user_id, provider, subject, label, created_at) VALUES (?, ?, ?, ?, ?)');
  const relabel = db.prepare('UPDATE identities SET label = ? WHERE provider = ? AND subject = ?');
  const remove = db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?');

  return {
    find(provider, subject) {
      const row = bySubject.get(provider, subject) as Row | undefined;
      return row ? toRecord(row) : undefined;
    },
    listByUser(userId) {
      return (byUser.all(userId) as Row[]).map(toRecord);
    },
    link(userId, provider, subject, label) {
      insert.run(userId, provider, subject, label, now());
    },
    updateLabel(provider, subject, label) {
      relabel.run(label, provider, subject);
    },
    unlink(userId, provider) {
      return Number(remove.run(userId, provider).changes);
    },
  };
}
