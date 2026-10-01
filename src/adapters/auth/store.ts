/**
 * 账号表的读写。用户名唯一、大小写不敏感（存小写）；密码只存 scrypt 哈希，见 ./password.ts。
 * 库文件的位置和表结构见 ./db.ts。
 * 首次打开且表为空时，若环境变量 INITIAL_ADMIN_USER / INITIAL_ADMIN_PASSWORD 都给了，创建这个管理员账号。
 */
import type { DatabaseSync } from 'node:sqlite';
import { openAuthDb } from './db';
import { hashPassword } from './password';

export { DEFAULT_AUTH_DB_FILE, authDbFilePath } from './db';
export type Role = 'admin' | 'user';

export interface LoginStamp {
  readonly at: number;
  readonly ip: string | null;
}

export interface UserRecord {
  readonly id: number;
  readonly username: string;
  /** 昵称，只用于显示；身份（日历订阅、Steam 绑定按它隔离）始终是 username */
  readonly displayName: string | null;
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: number;
  readonly lastLogin: LoginStamp | null;
  /** 最近一次之前的那次登录：个人中心的「上次登录」 */
  readonly previousLogin: LoginStamp | null;
}

export type UserSummary = Pick<UserRecord, 'id' | 'username' | 'displayName' | 'role' | 'createdAt' | 'lastLogin'>;

export interface AuthStore {
  findByUsername(username: string): UserRecord | undefined;
  findById(id: number): UserRecord | undefined;
  listUsers(): readonly UserSummary[];
  createUser(username: string, passwordHash: string, role: Role): UserRecord;
  updatePassword(id: number, passwordHash: string): void;
  updateDisplayName(id: number, displayName: string | null): void;
  /** 这次登录记成最近一次，原来的最近一次挪到「上次」 */
  recordLogin(id: number, stamp: LoginStamp): void;
  deleteUser(id: number): void;
  close(): void;
}

const USERNAME = /^[\w.@-]{1,64}$/;
const DISPLAY_NAME_MAX = 32;
// 控制字符、零宽字符、双向文本控制符和 BOM：显示名里出现它们只会用来伪装或者搞乱排版
const INVISIBLE = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;

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

/** 昵称：去掉首尾空白，空的等于不设；最多 32 个字符，不许有看不见的控制字符 */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim();
  if (name === '') return null;
  if ([...name].length > DISPLAY_NAME_MAX) throw new AuthInputError(`昵称最多 ${DISPLAY_NAME_MAX} 个字`);
  if (INVISIBLE.test(name)) throw new AuthInputError('昵称里有不可见的字符');
  return name;
}

type Row = Record<string, unknown>;

function stamp(at: unknown, ip: unknown): LoginStamp | null {
  return typeof at === 'number' ? { at, ip: typeof ip === 'string' ? ip : null } : null;
}

function toRecord(row: Row): UserRecord {
  return {
    id: row.id as number,
    username: row.username as string,
    displayName: (row.display_name as string | null) ?? null,
    passwordHash: row.password_hash as string,
    role: row.role as Role,
    createdAt: row.created_at as number,
    lastLogin: stamp(row.last_login_at, row.last_login_ip),
    previousLogin: stamp(row.prev_login_at, row.prev_login_ip),
  };
}

export interface AuthStoreOptions {
  /** 和会话表共用的连接；不给时按 filePath（再不给按环境变量）自己打开一个 */
  readonly db?: DatabaseSync;
  readonly filePath?: string;
}

export function createAuthStore(options: AuthStoreOptions = {}): AuthStore {
  const db = options.db ?? openAuthDb(options.filePath);

  const byUsername = db.prepare('SELECT * FROM users WHERE username = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const all = db.prepare('SELECT * FROM users ORDER BY id');
  const insert = db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)');
  const updatePwd = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  const updateName = db.prepare('UPDATE users SET display_name = ? WHERE id = ?');
  const login = db.prepare(
    `UPDATE users SET prev_login_at = last_login_at, prev_login_ip = last_login_ip,
       last_login_at = ?, last_login_ip = ? WHERE id = ?`,
  );
  const remove = db.prepare('DELETE FROM users WHERE id = ?');

  return {
    findByUsername(username) {
      const row = byUsername.get(normalizeUsername(username)) as Row | undefined;
      return row ? toRecord(row) : undefined;
    },
    findById(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? toRecord(row) : undefined;
    },
    listUsers() {
      return (all.all() as Row[]).map((row) => {
        const { id, username, displayName, role, createdAt, lastLogin } = toRecord(row);
        return { id, username, displayName, role, createdAt, lastLogin };
      });
    },
    createUser(username, passwordHash, role) {
      const normalized = normalizeUsername(username);
      const createdAt = Date.now();
      const result = insert.run(normalized, passwordHash, role, createdAt);
      return {
        id: Number(result.lastInsertRowid),
        username: normalized,
        displayName: null,
        passwordHash,
        role,
        createdAt,
        lastLogin: null,
        previousLogin: null,
      };
    },
    updatePassword(id, passwordHash) {
      updatePwd.run(passwordHash, id);
    },
    updateDisplayName(id, displayName) {
      updateName.run(displayName, id);
    },
    recordLogin(id, { at, ip }) {
      login.run(at, ip, id);
    },
    deleteUser(id) {
      remove.run(id);
    },
    close() {
      db.close();
    },
  };
}

/** 服务启动时调用一次：表为空且配了初始管理员环境变量时创建它 */
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
