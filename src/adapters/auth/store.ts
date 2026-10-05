/**
 * 账号表的读写。用户名唯一、大小写不敏感（存小写）；密码只存 scrypt 哈希，见 ./password.ts。
 * 库文件的位置和表结构见 ./db.ts。
 * 首次打开且表为空时，若环境变量 INITIAL_ADMIN_USER / INITIAL_ADMIN_PASSWORD 都给了，创建这个管理员账号。
 */
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { inTransaction, openAuthDb } from './db';
import { hashPassword } from './password';

export { DEFAULT_AUTH_DB_FILE, authDbFilePath } from './db';
export type Role = 'admin' | 'user';
/** 账号从哪来的：管理员开通，或者自己用邮箱 / GitHub / Google 注册 */
export type SignupMethod = 'admin' | 'password' | 'github' | 'google';

export interface LoginStamp {
  readonly at: number;
  readonly ip: string | null;
}

export interface UserRecord {
  readonly id: number;
  readonly username: string;
  /** 昵称，只用于显示；身份（日历订阅、Steam 绑定按它隔离）始终是 username */
  readonly displayName: string | null;
  /** 只用第三方登录、还没设过密码的账号是空串 */
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: number;
  readonly lastLogin: LoginStamp | null;
  /** 最近一次之前的那次登录：个人中心的「上次登录」 */
  readonly previousLogin: LoginStamp | null;
  /** 验证过的邮箱（小写）；管理员开通的老账号可以没有 */
  readonly email: string | null;
  readonly signupMethod: SignupMethod;
  /** 默认色块头像的种子（32 位十六进制） */
  readonly avatarSeed: string;
  /** 自己上传的头像文件名；没传过是 null */
  readonly avatarFile: string | null;
}

export type UserSummary = Pick<
  UserRecord,
  'id' | 'username' | 'displayName' | 'role' | 'createdAt' | 'lastLogin' | 'email' | 'signupMethod' | 'avatarSeed' | 'avatarFile'
>;

export interface NewUserExtras {
  readonly displayName?: string | null;
  readonly email?: string | null;
  readonly signupMethod?: SignupMethod;
}

export interface AuthStore {
  findByUsername(username: string): UserRecord | undefined;
  findById(id: number): UserRecord | undefined;
  /** email 要先经过 normalizeEmail */
  findByEmail(email: string): UserRecord | undefined;
  listUsers(): readonly UserSummary[];
  createUser(username: string, passwordHash: string, role: Role, extras?: NewUserExtras): UserRecord;
  updatePassword(id: number, passwordHash: string): void;
  updateDisplayName(id: number, displayName: string | null): void;
  updateEmail(id: number, email: string | null): void;
  /** 自己上传的头像文件名（adapters/avatars），null 是换回默认色块图 */
  updateAvatarFile(id: number, file: string | null): void;
  /** 这次登录记成最近一次，原来的最近一次挪到「上次」 */
  recordLogin(id: number, stamp: LoginStamp): void;
  /** 删账号的同时记下它的用户名，以后注册不会再发出去 */
  deleteUser(id: number): void;
  isRetired(username: string): boolean;
  /** since 之后自己注册（不是管理员开通）的账号数：全站每日注册上限用 */
  countSignupsSince(since: number): number;
  close(): void;
}

const USERNAME = /^[\w.@-]{1,64}$/;
/** 自己注册时的用户名更严：3-32 位小写字母、数字、. _ -，字母或数字开头；不许 @，免得和邮箱混淆 */
const SIGNUP_USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
/** 容易冒充站方的名字，自己注册时不给（管理员开通不受限） */
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'staff', 'official', 'moderator', 'owner', 'webmaster', 'anonymous',
]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const DISPLAY_NAME_MAX = 32;
// 控制字符、零宽字符、双向文本控制符和 BOM：显示名里出现它们只会用来伪装或者搞乱排版
const INVISIBLE = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;

/** 业务规则拒绝，message 是给用户看的中文说明。status：400 填错了；429 太频繁或今天名额用完；503 本站没配好（发信等） */
export class AuthInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 429 | 503 = 400,
  ) {
    super(message);
    this.name = 'AuthInputError';
  }
}

export function normalizeUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!USERNAME.test(username)) throw new AuthInputError('用户名格式不对（1-64 位字母、数字、. _ @ -）');
  return username;
}

/** 自己注册（填表或第三方登录自动起名）时的用户名规则：先过通用格式，再查保留字 */
export function normalizeSignupUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!SIGNUP_USERNAME.test(username)) {
    throw new AuthInputError('用户名要 3-32 位，只能用小写字母、数字和 . _ -，并以字母或数字开头');
  }
  if (RESERVED_USERNAMES.has(username)) throw new AuthInputError('这个用户名不能注册');
  return username;
}

/** 邮箱统一存小写；只做基本的格式检查，是不是真的能收信靠验证码 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !EMAIL.test(email)) throw new AuthInputError('邮箱格式不对');
  return email;
}

export const newAvatarSeed = () => randomBytes(16).toString('hex');

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
    email: (row.email as string | null) ?? null,
    signupMethod: row.signup_method as SignupMethod,
    avatarSeed: row.avatar_seed as string,
    avatarFile: (row.avatar_file as string | null) ?? null,
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
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const all = db.prepare('SELECT * FROM users ORDER BY id');
  const insert = db.prepare(
    `INSERT INTO users (username, password_hash, role, created_at, avatar_seed, display_name, email, signup_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updatePwd = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  const updateName = db.prepare('UPDATE users SET display_name = ? WHERE id = ?');
  const updateMail = db.prepare('UPDATE users SET email = ? WHERE id = ?');
  const updateAvatar = db.prepare('UPDATE users SET avatar_file = ? WHERE id = ?');
  const login = db.prepare(
    `UPDATE users SET prev_login_at = last_login_at, prev_login_ip = last_login_ip,
       last_login_at = ?, last_login_ip = ? WHERE id = ?`,
  );
  const retire = db.prepare('INSERT OR REPLACE INTO retired_usernames (username, retired_at) VALUES (?, ?)');
  const retired = db.prepare('SELECT 1 FROM retired_usernames WHERE username = ?');
  const remove = db.prepare('DELETE FROM users WHERE id = ?');
  const signups = db.prepare("SELECT count(*) AS n FROM users WHERE signup_method != 'admin' AND created_at >= ?");

  return {
    findByUsername(username) {
      const row = byUsername.get(normalizeUsername(username)) as Row | undefined;
      return row ? toRecord(row) : undefined;
    },
    findById(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? toRecord(row) : undefined;
    },
    findByEmail(email) {
      const row = byEmail.get(email) as Row | undefined;
      return row ? toRecord(row) : undefined;
    },
    listUsers() {
      return (all.all() as Row[]).map((row) => {
        const { id, username, displayName, role, createdAt, lastLogin, email, signupMethod, avatarSeed, avatarFile } =
          toRecord(row);
        return { id, username, displayName, role, createdAt, lastLogin, email, signupMethod, avatarSeed, avatarFile };
      });
    },
    createUser(username, passwordHash, role, { displayName = null, email = null, signupMethod = 'admin' } = {}) {
      const normalized = normalizeUsername(username);
      const createdAt = Date.now();
      const avatarSeed = newAvatarSeed();
      const result = insert.run(normalized, passwordHash, role, createdAt, avatarSeed, displayName, email, signupMethod);
      return {
        id: Number(result.lastInsertRowid),
        username: normalized,
        displayName,
        passwordHash,
        role,
        createdAt,
        lastLogin: null,
        previousLogin: null,
        email,
        signupMethod,
        avatarSeed,
        avatarFile: null,
      };
    },
    updatePassword(id, passwordHash) {
      updatePwd.run(passwordHash, id);
    },
    updateDisplayName(id, displayName) {
      updateName.run(displayName, id);
    },
    updateEmail(id, email) {
      updateMail.run(email, id);
    },
    updateAvatarFile(id, file) {
      updateAvatar.run(file, id);
    },
    recordLogin(id, { at, ip }) {
      login.run(at, ip, id);
    },
    deleteUser(id) {
      const row = byId.get(id) as Row | undefined;
      if (!row) return;
      inTransaction(db, () => {
        retire.run(row.username as string, Date.now());
        remove.run(id);
      });
    },
    isRetired(username) {
      return retired.get(username.trim().toLowerCase()) !== undefined;
    },
    countSignupsSince(since) {
      return (signups.get(since) as { n: number }).n;
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
