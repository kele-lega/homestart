/**
 * 登录会话：进程内内存表，session id → { user, role, expiresAt }。单实例部署，重启后都要求重新登录。
 * id 是 32 字节随机数的 base64url，不可预测；Cookie 只存这个 id，用户名和角色查表得到，不放进 Cookie。
 */
import { randomBytes } from 'node:crypto';
import type { Role } from './store';

export const SESSION_COOKIE = 'home_session';
const SESSION_TTL_MS = 30 * 24 * 3_600_000;
const MAX_SESSIONS = 10_000;

export interface SessionData {
  readonly userId: number;
  readonly username: string;
  readonly role: Role;
}

interface Entry extends SessionData {
  readonly expiresAt: number;
}

export interface SessionStore {
  create(data: SessionData): string;
  read(id: string): SessionData | undefined;
  destroy(id: string): void;
}

export function createSessionStore(options: { readonly now?: () => number } = {}): SessionStore {
  const { now = () => Date.now() } = options;
  const sessions = new Map<string, Entry>();

  function prune(): void {
    const time = now();
    for (const [id, entry] of sessions) {
      if (entry.expiresAt <= time) sessions.delete(id);
    }
  }

  return {
    create(data) {
      // 表太大时先清过期的，仍然超限就丢最久没访问的（Map 按插入/重插顺序迭代）
      if (sessions.size >= MAX_SESSIONS) prune();
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { ...data, expiresAt: now() + SESSION_TTL_MS });
      return id;
    },
    read(id) {
      const entry = sessions.get(id);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        sessions.delete(id);
        return undefined;
      }
      // 续期：被用到的会话往后推满 TTL，同时移到 Map 末尾，配合上面的 LRU 丢弃策略
      sessions.delete(id);
      sessions.set(id, { ...entry, expiresAt: now() + SESSION_TTL_MS });
      return { userId: entry.userId, username: entry.username, role: entry.role };
    },
    destroy(id) {
      sessions.delete(id);
    },
  };
}

const defaultStore = createSessionStore();
export const { create: createSession, read: readSession, destroy: destroySession } = defaultStore;
