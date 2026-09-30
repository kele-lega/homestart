/**
 * 登录服务：校验账号密码、发会话、管理员的用户增删改。业务规则集中在这里，
 * 路由只负责读 Cookie/请求体、把结果转换成响应。
 */
import { hashPassword, verifyPassword } from './password';
import { createSessionStore, type SessionData, type SessionStore } from './session';
import { AuthInputError, createAuthStore, ensureInitialAdmin, type AuthStore, type Role } from './store';

const BAD_CREDENTIALS = '用户名或密码不对';
const MIN_PASSWORD_LENGTH = 8;

export interface AuthService {
  /** 用户名或密码不对时抛 AuthInputError（中文说明，不区分是哪一项错了） */
  login(username: string, password: string): Promise<{ sessionId: string; role: Role; username: string }>;
  logout(sessionId: string): void;
  currentUser(sessionId: string | undefined): SessionData | undefined;
  /** 仅管理员可调用；用户名重复或密码太短时抛 AuthInputError */
  createUser(username: string, password: string, role: Role): Promise<void>;
  listUsers(): ReturnType<AuthStore['listUsers']>;
  /** 不允许删除自己，避免管理员误操作后没人能管理 */
  deleteUser(id: number, requestedBy: number): void;
  resetPassword(id: number, password: string): Promise<void>;
}

export interface AuthServiceDeps {
  readonly store?: AuthStore;
  readonly sessions?: SessionStore;
}

function requirePasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AuthInputError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
}

export function createAuthService(deps: AuthServiceDeps = {}): AuthService {
  const store = deps.store ?? createAuthStore();
  const sessions = deps.sessions ?? createSessionStore();

  return {
    async login(username, password) {
      const user = store.findByUsername(username);
      // 用户不存在时也跑一次哈希校验，避免响应时间差暴露用户名是否存在
      const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, await hashPassword('x'));
      if (!user || !ok) throw new AuthInputError(BAD_CREDENTIALS);
      const sessionId = sessions.create({ userId: user.id, username: user.username, role: user.role });
      return { sessionId, role: user.role, username: user.username };
    },
    logout(sessionId) {
      sessions.destroy(sessionId);
    },
    currentUser(sessionId) {
      return sessionId ? sessions.read(sessionId) : undefined;
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
      store.deleteUser(id);
    },
    async resetPassword(id, password) {
      requirePasswordStrength(password);
      const passwordHash = await hashPassword(password);
      store.updatePassword(id, passwordHash);
    },
  };
}

async function bootstrap(): Promise<AuthService> {
  const store = createAuthStore();
  await ensureInitialAdmin(store);
  return createAuthService({ store });
}

let servicePromise: Promise<AuthService> | undefined;

/** 懒加载：第一次用到时才开数据库文件、跑初始管理员的建号逻辑 */
export function getAuthService(): Promise<AuthService> {
  servicePromise ??= bootstrap();
  return servicePromise;
}
