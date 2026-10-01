/**
 * 登录服务：校验账号密码、发会话、个人中心（昵称、改密码、登录设备）、管理员的用户增删改。
 * 业务规则集中在这里，路由只负责读 Cookie/请求体、把结果转换成响应。
 */
import type { DatabaseSync } from 'node:sqlite';
import { openAuthDb } from './db';
import { hashPassword, verifyPassword } from './password';
import { createSessionStore, type SessionInfo, type SessionStore, type SessionUser } from './session';
import {
  AuthInputError,
  createAuthStore,
  ensureInitialAdmin,
  normalizeDisplayName,
  type AuthStore,
  type LoginStamp,
  type Role,
  type UserSummary,
} from './store';

const BAD_CREDENTIALS = '用户名或密码不对';
const MIN_PASSWORD_LENGTH = 8;

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

export interface LoginResult {
  readonly token: string;
  readonly remember: boolean;
  readonly user: SessionUser;
}

export interface AccountOverview {
  readonly id: number;
  readonly username: string;
  readonly displayName: string | null;
  readonly role: Role;
  readonly createdAt: number;
  /** 这次登录之前的那一次；第一次登录时为 null */
  readonly previousLogin: LoginStamp | null;
}

/** 管理员对某个账号动手时的身份：改到自己时保留当前这台设备 */
export interface Actor {
  readonly userId: number;
  readonly sessionId: number;
}

export interface AuthService {
  /** 用户名或密码不对时抛 AuthInputError（中文说明，不区分是哪一项错了） */
  login(request: LoginRequest): Promise<LoginResult>;
  logout(token: string): void;
  currentUser(token: string | undefined): SessionUser | undefined;
  account(userId: number): AccountOverview | undefined;
  updateDisplayName(userId: number, raw: string): string | null;
  /** 旧密码不对、新密码太短或和旧的一样时抛 AuthInputError；成功后其它设备全部退出，返回退出了几台 */
  changePassword(actor: Actor, current: string, next: string): Promise<number>;
  listSessions(userId: number): readonly SessionInfo[];
  /** 当前这台设备不走这里，要退出请登出 */
  revokeSession(actor: Actor, sessionId: number): void;
  revokeOtherSessions(actor: Actor): number;
  /** 仅管理员可调用；用户名重复或密码太短时抛 AuthInputError */
  createUser(username: string, password: string, role: Role): Promise<void>;
  listUsers(): readonly UserSummary[];
  /** 不允许删除自己，避免管理员误操作后没人能管理 */
  deleteUser(id: number, requestedBy: number): void;
  /** 重置后这个账号的会话全部失效（重置自己时保留当前设备） */
  resetPassword(id: number, password: string, actor: Actor): Promise<void>;
}

/** 两张表必须来自同一个库连接：会话查询要连表 users */
export interface AuthServiceDeps {
  readonly store: AuthStore;
  readonly sessions: SessionStore;
}

function requirePasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AuthInputError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
}

/** 同一个连接上建好账号表和会话表 */
export function createAuthDeps(db: DatabaseSync, now?: () => number): AuthServiceDeps {
  return { store: createAuthStore({ db }), sessions: createSessionStore({ db, now }) };
}

export function createAuthService({ store, sessions }: AuthServiceDeps): AuthService {
  // 用户不存在时拿它校验一次，响应时间和「用户存在、密码错」一样，猜不出哪些用户名存在
  let dummyHash: Promise<string> | undefined;

  return {
    async login({ username, password, remember, userAgent = null, ip = null }) {
      const user = store.findByUsername(username);
      dummyHash ??= hashPassword('dummy-password');
      const ok = await verifyPassword(password, user ? user.passwordHash : await dummyHash);
      if (!user || !ok) throw new AuthInputError(BAD_CREDENTIALS);
      const { token, sessionId } = sessions.create({ userId: user.id, remember, userAgent, ip });
      store.recordLogin(user.id, { at: Date.now(), ip });
      const { id: userId, displayName, role } = user;
      return { token, remember, user: { sessionId, userId, username: user.username, displayName, role } };
    },
    logout(token) {
      sessions.destroy(token);
    },
    currentUser(token) {
      return token ? sessions.resolve(token) : undefined;
    },
    account(userId) {
      const user = store.findById(userId);
      if (!user) return undefined;
      const { id, username, displayName, role, createdAt, previousLogin } = user;
      return { id, username, displayName, role, createdAt, previousLogin };
    },
    updateDisplayName(userId, raw) {
      const displayName = normalizeDisplayName(raw);
      store.updateDisplayName(userId, displayName);
      return displayName;
    },
    async changePassword(actor, current, next) {
      const user = store.findById(actor.userId);
      if (!user || !(await verifyPassword(current, user.passwordHash))) throw new AuthInputError('当前密码不对');
      requirePasswordStrength(next);
      if (next === current) throw new AuthInputError('新密码和当前密码一样');
      store.updatePassword(user.id, await hashPassword(next));
      return sessions.revokeOthers(user.id, actor.sessionId);
    },
    listSessions(userId) {
      return sessions.list(userId);
    },
    revokeSession(actor, sessionId) {
      if (sessionId === actor.sessionId) throw new AuthInputError('这是当前设备，要退出请点「登出」');
      if (sessions.revoke(actor.userId, sessionId) === 0) throw new AuthInputError('这个登录已经失效了');
    },
    revokeOtherSessions(actor) {
      return sessions.revokeOthers(actor.userId, actor.sessionId);
    },
    async createUser(username, password, role) {
      requirePasswordStrength(password);
      if (store.findByUsername(username)) throw new AuthInputError('用户名已经被使用');
      const passwordHash = await hashPassword(password);
      store.createUser(username, passwordHash, role);
    },
    listUsers() {
      return store.listUsers();
    },
    deleteUser(id, requestedBy) {
      if (id === requestedBy) throw new AuthInputError('不能删除自己的账号');
      // 会话表外键 ON DELETE CASCADE，这个账号的登录随之失效
      store.deleteUser(id);
    },
    async resetPassword(id, password, actor) {
      requirePasswordStrength(password);
      if (!store.findById(id)) throw new AuthInputError('没有这个账号');
      store.updatePassword(id, await hashPassword(password));
      if (id === actor.userId) sessions.revokeOthers(id, actor.sessionId);
      else sessions.revokeAll(id);
    },
  };
}

async function bootstrap(): Promise<AuthService> {
  const deps = createAuthDeps(openAuthDb());
  await ensureInitialAdmin(deps.store);
  return createAuthService(deps);
}

let servicePromise: Promise<AuthService> | undefined;

/** 懒加载：第一次用到时才开数据库文件、跑初始管理员的建号逻辑 */
export function getAuthService(): Promise<AuthService> {
  servicePromise ??= bootstrap();
  return servicePromise;
}
