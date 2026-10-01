/**
 * 登录系统的 SQLite 文件：账号表和会话表放在同一个库里，用户删除时会话跟着级联删除。
 * 路径取环境变量 AUTH_DB_FILE（默认 data/auth.db）；写 `:memory:` 得到只活在进程里的库，给测试和 e2e 用。
 * 表结构按 PRAGMA user_version 逐级升级，旧版本（只有 users 表）的库打开时自动补上新字段和会话表。
 */
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { settingsFilePath } from '../user-store';

export const DEFAULT_AUTH_DB_FILE = 'data/auth.db';
const MEMORY = ':memory:';

export function authDbFilePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AUTH_DB_FILE?.trim() === MEMORY) return MEMORY;
  return settingsFilePath(env, 'AUTH_DB_FILE', DEFAULT_AUTH_DB_FILE);
}

/** 第 i 项把库从版本 i 升到 i + 1 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at INTEGER NOT NULL
  )`,
  // 昵称、最近两次登录（「上次登录」显示的是这次之前的那一次）、服务端会话表
  `ALTER TABLE users ADD COLUMN display_name TEXT;
  ALTER TABLE users ADD COLUMN last_login_at INTEGER;
  ALTER TABLE users ADD COLUMN last_login_ip TEXT;
  ALTER TABLE users ADD COLUMN prev_login_at INTEGER;
  ALTER TABLE users ADD COLUMN prev_login_ip TEXT;
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remember INTEGER NOT NULL CHECK (remember IN (0, 1)),
    user_agent TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expires ON sessions(expires_at);`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: DatabaseSync): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    // 每一级单独一个事务：中途失败回滚到上一个完整版本，下次启动从那里继续
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** 打开（必要时创建）库文件并升级到最新结构；目录不存在时先建好，只给当前用户读写 */
export function openAuthDb(file: string = authDbFilePath()): DatabaseSync {
  if (file !== MEMORY) mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  // SQLite 默认不执行外键约束，删用户时靠它级联删会话
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}
