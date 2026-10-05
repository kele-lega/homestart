/**
 * 自助注册：邮箱验证码注册、忘记密码、改绑邮箱、GitHub / Google 登录（第一次来自动建号）和绑定解绑。
 * 和 service.ts 共用一个库连接；规则：不按邮箱自动合并账号，每个账号至少留一种登录方式，
 * 用户名一旦发出去就不能改（数据隔离按它），删掉的账号的用户名也不会再发
 */
import { randomBytes } from 'node:crypto';
import { createRateLimiter, type RateLimiter } from '../../core/rate-limit';
import type { LoginOptionsView, NoticeCode } from '../../lib/account-view';
import { createResendMailer, type Mailer } from '../mail';
import { createTurnstileCheck, type HumanCheck } from '../turnstile';
import { readAuthConfig, type AuthConfig } from './config';
import { inTransaction } from './db';
import { createCodeStore, type CodePurpose, type CodeStore } from './email-codes';
import { PROVIDERS, type Provider } from './identities';
import type { OAuthProfile } from './oauth';
import { hashPassword } from './password';
import { getAuthDeps, requirePasswordStrength, type AuthServiceDeps, type LoginResult } from './service';
import { AuthInputError, normalizeDisplayName, normalizeEmail, normalizeSignupUsername, type UserRecord } from './store';

export interface ClientInfo {
  readonly userAgent: string | null;
  readonly ip: string | null;
}

export interface SignupRequest {
  readonly email: string;
  readonly code: string;
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
}

/** login：从登录页来，没绑过就建号；link：已登录，从个人中心来绑到自己账号上 */
export type OAuthIntent = { readonly mode: 'login'; readonly remember: boolean } | { readonly mode: 'link'; readonly userId: number };

export type OAuthOutcome =
  | { readonly kind: 'login'; readonly created: boolean; readonly result: LoginResult }
  | { readonly kind: 'linked' };

/** 第三方登录走整页跳转，出错时带着提示代码跳回登录页或个人中心 */
export class OAuthRejected extends Error {
  constructor(readonly notice: NoticeCode) {
    super(notice);
    this.name = 'OAuthRejected';
  }
}

export interface Registration {
  /** 登录 / 注册页要显示哪些方式 */
  options(): LoginOptionsView;
  /** 邮箱已注册时改发一封「已经注册过」的信，响应一样，猜不出哪些邮箱注册过 */
  requestSignupCode(email: string, turnstile: string, client: ClientInfo): Promise<void>;
  completeSignup(request: SignupRequest, client: ClientInfo): Promise<LoginResult>;
  /** 不管邮箱有没有注册都说「发了」 */
  requestResetCode(email: string, turnstile: string, client: ClientInfo): Promise<void>;
  /** 成功后这个账号所有设备退出，当前设备重新登录（不记住） */
  completeReset(email: string, code: string, password: string, client: ClientInfo): Promise<LoginResult>;
  requestEmailCode(userId: number, email: string): Promise<void>;
  changeEmail(userId: number, email: string, code: string): string;
  unlinkIdentity(userId: number, provider: Provider): void;
  completeOAuth(profile: OAuthProfile, intent: OAuthIntent, client: ClientInfo): OAuthOutcome;
}

export interface RegistrationDeps extends AuthServiceDeps {
  readonly config: AuthConfig;
  readonly codes: CodeStore;
  /** 没配发信时为 null：邮箱注册、找回密码、改邮箱都不开 */
  readonly mailer: Mailer | null;
  /** 没配人机验证时为 null，只靠按 IP 限流 */
  readonly humanCheck: HumanCheck | null;
  readonly now?: () => number;
  readonly logError?: (message: string) => void;
}

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const NO_MAIL = '本站还没开通邮件，暂时不能用邮箱注册或找回密码';
const BAD_CODE = '验证码不对或已经过期，请重新获取';
const TOO_FAST = '尝试太频繁，请稍后再试';
const DAILY_FULL = '今天的注册名额已经用完了，明天再来吧';

const ISSUE_FAILURES = {
  cooldown: '验证码刚发过，等一分钟再重发',
  quota: '这个邮箱这一小时收的验证码太多了，过一会儿再试',
  daily: '本站今天发信的额度用完了，明天再来吧',
} as const;

/** 第三方给的名字整理成用户名的底子：只留小写字母、数字、. _ -，开头必须是字母或数字 */
export function usernameBase(hint: string): string {
  const cleaned = hint
    .normalize('NFKD')
    // 拆出来的重音符号直接去掉：Ünïcode → unicode，而不是 u-ni-code
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 24)
    .replace(/[._-]+$/, '');
  return cleaned.length >= 3 ? cleaned : `user-${cleaned}`.replace(/-$/, '');
}

function signupNameOk(name: string): boolean {
  try {
    return normalizeSignupUsername(name) === name;
  } catch (error) {
    if (error instanceof AuthInputError) return false;
    throw error;
  }
}

/** 第三方给的昵称、邮箱不合本站规则就不要，不因为这个注册失败 */
function lenient<T>(normalize: (raw: string) => T, raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return normalize(raw);
  } catch (error) {
    if (error instanceof AuthInputError) return null;
    throw error;
  }
}

const signupCodeMail = (site: string, code: string) => ({
  subject: `${site} 注册验证码：${code}`,
  text: `你的注册验证码是 ${code}，10 分钟内有效。\n\n不是你本人操作的话，忽略这封信就好，不会有账号用到这个邮箱。`,
});
const alreadyRegisteredMail = (site: string) => ({
  subject: `${site}：这个邮箱已经注册过了`,
  text: `有人（可能是你）想用这个邮箱在 ${site} 注册新账号，但它已经注册过了。\n\n直接用用户名或这个邮箱登录就好；忘了密码可以在登录页点「忘记密码」。不是你本人操作的话，忽略这封信。`,
});
const resetCodeMail = (site: string, code: string) => ({
  subject: `${site} 重设密码验证码：${code}`,
  text: `你的重设密码验证码是 ${code}，10 分钟内有效。\n\n不是你本人操作的话，忽略这封信，密码不会变。`,
});
const emailCodeMail = (site: string, code: string) => ({
  subject: `${site} 绑定邮箱验证码：${code}`,
  text: `你正在把这个邮箱绑定到 ${site} 的账号上，验证码是 ${code}，10 分钟内有效。\n\n不是你本人操作的话，忽略这封信。`,
});

export function createRegistration(deps: RegistrationDeps): Registration {
  const { db, store, sessions, identities, config, codes, mailer, humanCheck, now = () => Date.now() } = deps;
  const logError = deps.logError ?? ((message: string) => console.error(message));
  const site = config.siteOrigin ? new URL(config.siteOrigin).hostname : 'homestart';
  const limiter = (limit: number, windowMs: number): RateLimiter => createRateLimiter({ limit, windowMs, maxKeys: 5000 });
  // 按 IP：要验证码（含找回密码）、填验证码、真正建号（含第三方自动建号）
  const allowSend = limiter(10, HOUR_MS);
  const allowVerify = limiter(20, HOUR_MS);
  const allowCreate = limiter(3, HOUR_MS);
  const allowEmailChange = limiter(10, HOUR_MS);

  const requireMailer = (): Mailer => {
    if (!mailer) throw new AuthInputError(NO_MAIL, 503);
    return mailer;
  };
  const throttle = (allow: RateLimiter, key: string | null) => {
    if (!allow(key ?? 'unknown')) throw new AuthInputError(TOO_FAST, 429);
  };
  async function requireHuman(token: string, ip: string | null): Promise<void> {
    if (!humanCheck) return;
    let passed: boolean;
    try {
      passed = await humanCheck(token, ip);
    } catch (error) {
      logError(`人机验证服务出错：${error instanceof Error ? error.message : String(error)}`);
      throw new AuthInputError('人机验证暂时用不了，请稍后再试', 503);
    }
    if (!passed) throw new AuthInputError('人机验证没通过，请重新验证');
  }
  const issue = (purpose: CodePurpose, key: string): string => {
    const result = codes.issue(purpose, key);
    if (!result.ok) throw new AuthInputError(ISSUE_FAILURES[result.reason], 429);
    return result.code;
  };
  async function send(to: string, mail: { subject: string; text: string }): Promise<void> {
    try {
      await requireMailer()({ to, ...mail });
    } catch (error) {
      if (error instanceof AuthInputError) throw error;
      logError(`发信失败：${error instanceof Error ? error.message : String(error)}`);
      throw new AuthInputError('邮件没发出去，请稍后再试', 503);
    }
  }
  const requireSignupRoom = () => {
    if (store.countSignupsSince(now() - DAY_MS) >= config.dailySignupLimit) throw new AuthInputError(DAILY_FULL, 429);
  };
  const requireFree = (username: string, email: string | null) => {
    if (store.isRetired(username) || store.findByUsername(username)) throw new AuthInputError('用户名已经被使用');
    if (email && store.findByEmail(email)) throw new AuthInputError('这个邮箱已经注册过了，直接登录就好');
  };
  function pickUsername(hint: string): string {
    const base = usernameBase(hint);
    const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base}${i + 2}`)];
    for (let i = 0; i < 20; i += 1) candidates.push(`${base}-${randomBytes(3).toString('hex')}`);
    const free = candidates.find((name) => signupNameOk(name) && !store.isRetired(name) && !store.findByUsername(name));
    if (!free) throw new OAuthRejected('oauth-failed');
    return free;
  }
  function openSession(user: UserRecord, remember: boolean, { userAgent, ip }: ClientInfo): LoginResult {
    const { token, sessionId } = sessions.create({ userId: user.id, remember, userAgent, ip });
    store.recordLogin(user.id, { at: now(), ip });
    const { id: userId, username, displayName, role } = user;
    return { token, remember, user: { sessionId, userId, username, displayName, role } };
  }

  return {
    options() {
      return {
        providers: PROVIDERS.filter((provider) => config.oauth[provider]),
        email: mailer !== null,
        turnstileSiteKey: humanCheck && config.turnstile ? config.turnstile.siteKey : null,
      };
    },
    async requestSignupCode(rawEmail, turnstile, { ip }) {
      requireMailer();
      const email = normalizeEmail(rawEmail);
      throttle(allowSend, ip);
      await requireHuman(turnstile, ip);
      // 已注册的邮箱也照样占冷却和额度，响应和没注册的一样
      const code = issue('signup', email);
      await send(email, store.findByEmail(email) ? alreadyRegisteredMail(site) : signupCodeMail(site, code));
    },
    async completeSignup({ email: rawEmail, code, username: rawUsername, password, remember }, client) {
      requireMailer();
      throttle(allowVerify, client.ip);
      const email = normalizeEmail(rawEmail);
      const username = normalizeSignupUsername(rawUsername);
      requirePasswordStrength(password);
      // 邮箱占没占先不查：已注册的邮箱收不到验证码，随便填个码只会得到「验证码不对」，探测不出谁注册过
      requireFree(username, null);
      requireSignupRoom();
      if (!codes.consume('signup', email, code)) throw new AuthInputError(BAD_CODE);
      throttle(allowCreate, client.ip);
      const passwordHash = await hashPassword(password);
      // 算哈希要几十毫秒，这期间可能被别的请求抢先注册，再查一次
      requireFree(username, email);
      const user = store.createUser(username, passwordHash, 'user', { email, signupMethod: 'password' });
      return openSession(user, remember, client);
    },
    async requestResetCode(rawEmail, turnstile, { ip }) {
      requireMailer();
      const email = normalizeEmail(rawEmail);
      throttle(allowSend, ip);
      await requireHuman(turnstile, ip);
      // 没注册的邮箱也走一遍冷却和额度，提示一样；信在后台发，响应时间也看不出区别
      const code = issue('reset', email);
      if (!store.findByEmail(email)) return;
      void send(email, resetCodeMail(site, code)).catch(() => undefined);
    },
    async completeReset(rawEmail, code, password, client) {
      requireMailer();
      throttle(allowVerify, client.ip);
      const email = normalizeEmail(rawEmail);
      requirePasswordStrength(password);
      const user = store.findByEmail(email);
      if (!codes.consume('reset', email, code) || !user) throw new AuthInputError(BAD_CODE);
      store.updatePassword(user.id, await hashPassword(password));
      sessions.revokeAll(user.id);
      return openSession(user, false, client);
    },
    async requestEmailCode(userId, rawEmail) {
      requireMailer();
      throttle(allowEmailChange, `user:${userId}`);
      const email = normalizeEmail(rawEmail);
      const user = store.findById(userId);
      if (!user) throw new AuthInputError('账号不存在');
      if (user.email === email) throw new AuthInputError('这就是你现在的邮箱');
      if (store.findByEmail(email)) throw new AuthInputError('这个邮箱已经绑在别的账号上了');
      await send(email, emailCodeMail(site, issue('email', `${userId}:${email}`)));
    },
    changeEmail(userId, rawEmail, code) {
      requireMailer();
      throttle(allowEmailChange, `user:${userId}`);
      const email = normalizeEmail(rawEmail);
      if (!codes.consume('email', `${userId}:${email}`, code)) throw new AuthInputError(BAD_CODE);
      const owner = store.findByEmail(email);
      if (owner && owner.id !== userId) throw new AuthInputError('这个邮箱已经绑在别的账号上了');
      store.updateEmail(userId, email);
      return email;
    },
    unlinkIdentity(userId, provider) {
      const user = store.findById(userId);
      if (!user) throw new AuthInputError('账号不存在');
      const linked = identities.listByUser(userId);
      if (!linked.some((identity) => identity.provider === provider)) throw new AuthInputError('没有绑定这个账号');
      if (user.passwordHash === '' && linked.length <= 1) {
        throw new AuthInputError('这是你唯一的登录方式：先在「改密码」里设一个密码，或绑定另一个账号，再来解绑');
      }
      identities.unlink(userId, provider);
    },
    completeOAuth(profile, intent, client) {
      const { provider, subject, label } = profile;
      const existing = identities.find(provider, subject);

      if (intent.mode === 'link') {
        if (existing) {
          if (existing.userId !== intent.userId) throw new OAuthRejected('oauth-linked-elsewhere');
          identities.updateLabel(provider, subject, label);
          return { kind: 'linked' };
        }
        if (identities.listByUser(intent.userId).some((identity) => identity.provider === provider)) {
          throw new OAuthRejected('oauth-already-linked');
        }
        const email = lenient(normalizeEmail, profile.email);
        inTransaction(db, () => {
          identities.link(intent.userId, provider, subject, label);
          // 账号还没邮箱、对方给的邮箱又没人用，顺手补上，以后能用它找回密码
          const user = store.findById(intent.userId);
          if (user && !user.email && email && !store.findByEmail(email)) store.updateEmail(user.id, email);
        });
        return { kind: 'linked' };
      }

      if (existing) {
        const user = store.findById(existing.userId);
        if (!user) throw new OAuthRejected('oauth-failed');
        identities.updateLabel(provider, subject, label);
        return { kind: 'login', created: false, result: openSession(user, intent.remember, client) };
      }

      // 第一次用这个第三方账号来：自动建号。只认验证过的邮箱；邮箱被占了也不自动合并
      const email = lenient(normalizeEmail, profile.email);
      if (!email) throw new OAuthRejected('oauth-no-email');
      if (store.findByEmail(email)) throw new OAuthRejected('oauth-email-taken');
      if (store.countSignupsSince(now() - DAY_MS) >= config.dailySignupLimit) throw new OAuthRejected('signup-closed');
      if (!allowCreate(client.ip ?? 'unknown')) throw new OAuthRejected('signup-rate');
      const username = pickUsername(profile.usernameHint);
      const displayName = lenient(normalizeDisplayName, profile.displayName);
      const user = inTransaction(db, () => {
        const created = store.createUser(username, '', 'user', { displayName, email, signupMethod: provider });
        identities.link(created.id, provider, subject, label);
        return created;
      });
      return { kind: 'login', created: true, result: openSession(user, intent.remember, client) };
    },
  };
}

let registrationPromise: Promise<Registration> | undefined;

/** 懒加载，和登录服务共用一个库连接；环境变量只在第一次用到时读 */
export function getRegistration(): Promise<Registration> {
  registrationPromise ??= getAuthDeps().then((auth) => {
    const config = readAuthConfig();
    return createRegistration({
      ...auth,
      config,
      codes: createCodeStore({ dailyLimit: config.dailyMailLimit }),
      mailer: config.mail ? createResendMailer(config.mail) : null,
      humanCheck: config.turnstile ? createTurnstileCheck(config.turnstile.secretKey) : null,
    });
  });
  return registrationPromise;
}

/** 第三方登录的路由要拿 client id / secret 和回调地址 */
export const getAuthConfig = (() => {
  let config: AuthConfig | undefined;
  return () => (config ??= readAuthConfig());
})();
