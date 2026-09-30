/**
 * 账号表：SQLite 文件，路径取环境变量 AUTH_DB_FILE，默认工作目录下的 data/auth.db（Windows 上无效）。
 * 用户名唯一、大小写不敏感（存小写）。密码只存 scrypt 哈希，见 ./password.ts。
 * 首次打开且表为空时，若环境变量 INITIAL_ADMIN_USER / INITIAL_ADMIN_PASSWORD 都给了，创建这个管理员账号。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { settingsFilePath } from '../user-store';
import { hashPassword } from './password';

export const DEFAULT_AUTH_DB_FILE = 'data/auth.db';
export type Role = 'admin' | 'user';

export interface UserRecord {
  readonly id: number;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: number;
}

export interface AuthStore {
  findByUsername(username: string): UserRecord | undefined;
  findById(id: number): UserRecord | undefined;
  listUsers(): readonly Omit<UserRecord, 'passwordHash'>[];
  createUser(username: string, passwordHash: string, role: Role): UserRecord;
  updatePassword(id: number, passwordHash: string): void;
  deleteUser(id: number): void;
  close(): void;
}

export function authDbFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'AUTH_DB_FILE', DEFAULT_AUTH_DB_FILE);
}

const USERNAME = /^[\w.@-]{1,64}$/;

export class AuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthInputError';
  }
}

export function normalizeUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!USERNAME.test(username)) throw new AuthInputError('用户名格式不对（1-64 位字母、数字、. _ @ -）');
  return username;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at INTEGER NOT NULL
  )
`;

function toRecord(row: Record<string, unknown>): UserRecord {
  return {
    id: row.id as number,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    role: row.role as Role,
    createdAt: row.created_at as number,
  };
}

export interface AuthStoreOptions {
  /** 测试时注入内存库；默认按环境变量取文件路径 */
  readonly filePath?: string;
}

export function createAuthStore(options: AuthStoreOptions = {}): AuthStore {
  const file = options.filePath ?? authDbFilePath();
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const byUsername = db.prepare('SELECT * FROM users WHERE username = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const all = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id');
  const insert = db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)');
  const updatePwd = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM users WHERE id = ?');

  return {
    findByUsername(username) {
      const row = byUsername.get(normalizeUsername(username)) as Record<string, unknown> | undefined;
      return row ? toRecord(row) : undefined;
    },
    findById(id) {
      const row = byId.get(id) as Record<string, unknown> | undefined;
      return row ? toRecord(row) : undefined;
    },
    listUsers() {
      return (all.all() as Record<string, unknown>[]).map((row) => ({
        id: row.id as number,
        username: row.username as string,
        role: row.role as Role,
        createdAt: row.created_at as number,
      }));
    },
    createUser(username, passwordHash, role) {
      const normalized = normalizeUsername(username);
      const result = insert.run(normalized, passwordHash, role, Date.now());
      return { id: Number(result.lastInsertRowid), username: normalized, passwordHash, role, createdAt: Date.now() };
    },
    updatePassword(id, passwordHash) {
      updatePwd.run(passwordHash, id);
    },
    deleteUser(id) {
      remove.run(id);
    },
    close() {
      db.close();
    },
  };
}

/** 服务启动时调用一次：数据库目录先建好，表为空且配了初始管理员环境变量时创建它 */
export async function ensureInitialAdmin(
  store: Pick<AuthStore, 'listUsers' | 'createUser'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (store.listUsers().length > 0) return;
  const username = env.INITIAL_ADMIN_USER?.trim();
  const password = env.INITIAL_ADMIN_PASSWORD?.trim();
  if (!username || !password) return;
  const passwordHash = await hashPassword(password);
  store.createUser(username, passwordHash, 'admin');
}

export async function ensureDbDirectory(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
}
