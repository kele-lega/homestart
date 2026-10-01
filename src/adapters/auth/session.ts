/**
 * 登录会话：存在 auth.db 的 sessions 表里，服务重启后照样有效。
 * Cookie 里是 32 字节随机数的 base64url（令牌），库里只存它的 SHA-256：库文件泄露了也拿不到能用的 Cookie。
 * 「记住我」的会话从登录起 30 天到期，不续期（和 Cookie 的 Max-Age 一致）；
 * 没勾的会话 Cookie 关掉浏览器就没了，服务端再按 12 小时无操作过期兜底，每次访问往后顺延。
 * 用户名、昵称、角色每次都连表查 users，改了立即生效，不在会话里留旧副本。
 */
import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Role } from './store';

export const SESSION_COOKIE = 'home_session';
export const REMEMBER_TTL_MS = 30 * 24 * 3_600_000;
export const IDLE_TTL_MS = 12 * 3_600_000;
/** 「最近活动」精确到分钟就够，不必每个请求都写一次库 */
const TOUCH_INTERVAL_MS = 60_000;
/** 每个账号最多保留的会话数，超出时丢最久没用的 */
export const MAX_SESSIONS_PER_USER = 20;
const MAX_TOKEN_LENGTH = 128;
const MAX_USER_AGENT_LENGTH = 256;

export interface SessionUser {
  /** 会话表的行号：给「登录设备」列表定位用，不是凭据 */
  readonly sessionId: number;
  readonly userId: number;
  readonly username: string;
  readonly displayName: string | null;
  readonly role: Role;
}

export interface SessionInfo {
  readonly id: number;
  readonly userAgent: string | null;
  readonly ip: string | null;
  readonly remember: boolean;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
}

export interface NewSession {
  readonly userId: number;
  readonly remember: boolean;
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

export interface SessionStore {
  /** 返回写进 Cookie 的令牌 */
  create(session: NewSession): { readonly token: string; readonly sessionId: number };
  resolve(token: string): SessionUser | undefined;
  destroy(token: string): void;
  list(userId: number): readonly SessionInfo[];
  /** 只删这个账号自己的会话；返回删掉了几条 */
  revoke(userId: number, sessionId: number): number;
  revokeOthers(userId: number, keepSessionId: number): number;
  revokeAll(userId: number): number;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

type Row = Record<string, unknown>;

function toInfo(row: Row): SessionInfo {
  return {
    id: row.id as number,
    userAgent: (row.user_agent as string | null) ?? null,
    ip: (row.ip as string | null) ?? null,
    remember: row.remember === 1,
    createdAt: row.created_at as number,
    lastSeenAt: row.last_seen_at as number,
    expiresAt: row.expires_at as number,
  };
}

export interface SessionStoreOptions {
  readonly db: DatabaseSync;
  readonly now?: () => number;
}

export function createSessionStore({ db, now = () => Date.now() }: SessionStoreOptions): SessionStore {
  const insert = db.prepare(
    `INSERT INTO sessions (token_hash, user_id, remember, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const pruneExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  // 给新会话腾位置：只留最近用过的 MAX - 1 条
  const pruneOldest = db.prepare(
    `DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
       SELECT id FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC, id DESC LIMIT ?)`,
  );
  const byToken = db.prepare(
    `SELECT s.id, s.user_id, s.remember, s.last_seen_at, s.expires_at, u.username, u.display_name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  );
  const touch = db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?');
  const removeById = db.prepare('DELETE FROM sessions WHERE id = ?');
  const removeByToken = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const listByUser = db.prepare(
    'SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC, id DESC',
  );
  const removeOwn = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?');
  const removeOthers = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?');
  const removeAll = db.prepare('DELETE FROM sessions WHERE user_id = ?');

  return {
    create({ userId, remember, userAgent = null, ip = null }) {
      const time = now();
      pruneExpired.run(time);
      pruneOldest.run(userId, userId, MAX_SESSIONS_PER_USER - 1);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = time + (remember ? REMEMBER_TTL_MS : IDLE_TTL_MS);
      const agent = userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null;
      const result = insert.run(hashToken(token), userId, remember ? 1 : 0, agent, ip, time, time, expiresAt);
      return { token, sessionId: Number(result.lastInsertRowid) };
    },
    resolve(token) {
      if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return undefined;
      const row = byToken.get(hashToken(token)) as Row | undefined;
      if (!row) return undefined;
      const time = now();
      const id = row.id as number;
      if ((row.expires_at as number) <= time) {
        removeById.run(id);
        return undefined;
      }
      if (time - (row.last_seen_at as number) >= TOUCH_INTERVAL_MS) {
        // 没勾「记住我」的会话按无操作时间顺延；勾了的到期时间固定不动
        const expiresAt = row.remember === 1 ? (row.expires_at as number) : time + IDLE_TTL_MS;
        touch.run(time, expiresAt, id);
      }
      return {
        sessionId: id,
        userId: row.user_id as number,
        username: row.username as string,
        displayName: (row.display_name as string | null) ?? null,
        role: row.role as Role,
      };
    },
    destroy(token) {
      if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return;
      removeByToken.run(hashToken(token));
    },
    list(userId) {
      return (listByUser.all(userId, now()) as Row[]).map(toInfo);
    },
    revoke(userId, sessionId) {
      return Number(removeOwn.run(userId, sessionId).changes);
    },
    revokeOthers(userId, keepSessionId) {
      return Number(removeOthers.run(userId, keepSessionId).changes);
    },
    revokeAll(userId) {
      return Number(removeAll.run(userId).changes);
    },
  };
}
