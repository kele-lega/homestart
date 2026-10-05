import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AuthConfig } from '../../../src/adapters/auth/config';
import { openAuthDb } from '../../../src/adapters/auth/db';
import { CODE_TTL_MS, RESEND_COOLDOWN_MS, createCodeStore } from '../../../src/adapters/auth/email-codes';
import type { OAuthProfile } from '../../../src/adapters/auth/oauth';
import { hashPassword } from '../../../src/adapters/auth/password';
import { createAuthDeps, createAuthService, type AuthServiceDeps } from '../../../src/adapters/auth/service';
import {
  OAuthRejected,
  createRegistration,
  usernameBase,
  type ClientInfo,
  type OAuthIntent,
  type Registration,
  type RegistrationDeps,
} from '../../../src/adapters/auth/signup';
import { AuthInputError } from '../../../src/adapters/auth/store';
import type { MailMessage } from '../../../src/adapters/mail';
import type { HumanCheck } from '../../../src/adapters/turnstile';

const PASSWORD = 'password123';
const EMAIL = 'ken@example.com';
const TURNSTILE = 'human-token';
const LOGIN: OAuthIntent = { mode: 'login', remember: true };

const CONFIG: AuthConfig = {
  siteOrigin: 'https://home.example.org',
  oauth: { github: { clientId: 'gh-id', clientSecret: 'gh-secret' }, google: { clientId: 'g-id', clientSecret: 'g-secret' } },
  mail: { apiKey: 're_key', from: 'homestart <noreply@example.org>' },
  turnstile: { siteKey: 'site-key', secretKey: 'secret-key' },
  dailySignupLimit: 50,
  dailyMailLimit: 100,
};

const github = (overrides: Partial<OAuthProfile> = {}): OAuthProfile => ({
  provider: 'github',
  subject: '42',
  label: 'octo',
  email: 'octo@example.com',
  displayName: 'Octo Cat',
  usernameHint: 'octo',
  ...overrides,
});

let ipCounter = 0;
/** 每次调用换一个 IP，按 IP 的限流只在专门测它的用例里起作用 */
const client = (): ClientInfo => ({ userAgent: 'UA', ip: `198.51.100.${(ipCounter += 1) % 250}` });
const fixed = (ip: string): ClientInfo => ({ userAgent: 'UA', ip });

const codeIn = (mail: MailMessage | undefined) => mail?.subject.match(/(\d{6})$/)?.[1] ?? '';
/** 和真码一定不一样的 6 位数 */
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

/** 等着它抛 AuthInputError，返回错误好看 message 和 status */
async function inputError(run: () => unknown): Promise<AuthInputError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AuthInputError) return error;
    throw error;
  }
  throw new Error('应该抛 AuthInputError，结果成功了');
}

function noticeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof OAuthRejected) return error.notice;
    throw error;
  }
  throw new Error('应该抛 OAuthRejected，结果成功了');
}

describe('usernameBase', () => {
  it('keeps a clean name as it is, lowercased', () => {
    expect(usernameBase('Octo-Cat')).toBe('octo-cat');
    expect(usernameBase('ken.lee_99')).toBe('ken.lee_99');
  });

  it('replaces disallowed characters and trims the edges', () => {
    expect(usernameBase('ken lee+tag')).toBe('ken-lee-tag');
    expect(usernameBase('__ken--')).toBe('ken');
  });

  it('caps the length at 24 without a trailing separator', () => {
    expect(usernameBase('a'.repeat(23) + '-bbbb')).toBe('a'.repeat(23));
    expect(usernameBase('x'.repeat(40))).toHaveLength(24);
  });

  it('pads too-short or empty names with user-', () => {
    expect(usernameBase('ab')).toBe('user-ab');
    expect(usernameBase('可乐')).toBe('user');
    expect(usernameBase('')).toBe('user');
  });

  it('drops accents instead of turning them into separators', () => {
    expect(usernameBase('Ünïcode')).toBe('unicode');
    expect(usernameBase('José Zoë')).toBe('jose-zoe');
  });

  it('always yields something the sign-up rules accept for latin input', () => {
    for (const hint of ['José Ünïcode', 'Zoë', '-.-', 'A', 'mail.name+x']) {
      expect(usernameBase(hint)).toMatch(/^[a-z0-9][a-z0-9._-]{2,31}$/);
    }
  });
});

describe('createRegistration', () => {
  let deps: AuthServiceDeps;
  let mails: MailMessage[];
  let humanCheck: Mock<HumanCheck>;
  let logError: Mock<(message: string) => void>;
  let clock: number;
  let registration: Registration;

  function build(overrides: Partial<RegistrationDeps> = {}): Registration {
    return createRegistration({
      ...deps,
      config: CONFIG,
      codes: createCodeStore({ dailyLimit: 100, now: () => clock }),
      mailer: async (message) => {
        mails.push(message);
      },
      humanCheck,
      logError,
      ...overrides,
    });
  }

  beforeEach(() => {
    deps = createAuthDeps(openAuthDb(':memory:'));
    mails = [];
    humanCheck = vi.fn(async (token: string) => token === TURNSTILE);
    logError = vi.fn();
    clock = Date.now();
    registration = build();
  });

  async function signupCode(email = EMAIL): Promise<string> {
    await registration.requestSignupCode(email, TURNSTILE, client());
    return codeIn(mails.at(-1));
  }

  const signup = (code: string, overrides: Partial<{ email: string; username: string; password: string }> = {}, who = client()) =>
    registration.completeSignup({ email: EMAIL, code, username: 'ken', password: PASSWORD, remember: true, ...overrides }, who);

  /** 管理员开通或之前注册好的账号 */
  const seedUser = async (username: string, email: string | null, password = PASSWORD) =>
    deps.store.createUser(username, password === '' ? '' : await hashPassword(password), 'user', { email, signupMethod: 'password' });

  describe('options', () => {
    it('lists configured providers, email sign-up and the Turnstile site key', () => {
      expect(registration.options()).toEqual({ providers: ['github', 'google'], email: true, turnstileSiteKey: 'site-key' });
    });

    it('turns email sign-up off without a mailer, and the site key off without a human check', () => {
      const bare = build({ mailer: null, humanCheck: null, config: { ...CONFIG, oauth: { google: CONFIG.oauth.google } } });
      expect(bare.options()).toEqual({ providers: ['google'], email: false, turnstileSiteKey: null });
    });

    it('answers 503 for every mail flow when mail is off', async () => {
      const bare = build({ mailer: null });
      for (const run of [
        () => bare.requestSignupCode(EMAIL, TURNSTILE, client()),
        () => bare.completeSignup({ email: EMAIL, code: '123456', username: 'ken', password: PASSWORD, remember: false }, client()),
        () => bare.requestResetCode(EMAIL, TURNSTILE, client()),
        () => bare.completeReset(EMAIL, '123456', PASSWORD, client()),
      ]) {
        const error = await inputError(run);
        expect(error.status).toBe(503);
        expect(error.message).toContain('还没开通邮件');
      }
    });
  });

  describe('email sign-up', () => {
    it('mails a code, creates the account and logs it in', async () => {
      const code = await signupCode();
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: EMAIL, subject: `home.example.org 注册验证码：${code}` });
      expect(mails[0]?.text).toContain(code);

      const result = await signup(code);
      expect(result).toMatchObject({ remember: true, user: { username: 'ken', role: 'user', displayName: null } });
      expect(deps.sessions.resolve(result.token)?.userId).toBe(result.user.userId);
      const user = deps.store.findById(result.user.userId);
      expect(user).toMatchObject({ email: EMAIL, signupMethod: 'password', role: 'user' });
      expect(user?.passwordHash).not.toBe('');
      expect(user?.lastLogin?.ip).toMatch(/^198\.51\.100\./);
    });

    it('normalizes email and username, and the new password logs in by username or email', async () => {
      const code = await signupCode('  Ken@Example.COM ');
      expect(mails[0]?.to).toBe(EMAIL);
      await signup(code, { email: 'KEN@example.com', username: ' Ken ' });
      const service = createAuthService(deps);
      for (const username of ['ken', EMAIL]) {
        await expect(service.login({ username, password: PASSWORD, remember: false })).resolves.toMatchObject({ user: { username: 'ken' } });
      }
    });

    it('refuses to mail when the human check fails, and 503s when it errors', async () => {
      const failed = await inputError(() => registration.requestSignupCode(EMAIL, 'bot', client()));
      expect(failed).toMatchObject({ status: 400, message: '人机验证没通过，请重新验证' });
      expect(humanCheck).toHaveBeenCalledWith('bot', expect.stringMatching(/^198\.51\.100\./));

      humanCheck.mockRejectedValueOnce(new Error('siteverify down'));
      const broken = await inputError(() => registration.requestSignupCode(EMAIL, TURNSTILE, client()));
      expect(broken.status).toBe(503);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('siteverify down'));
      expect(mails).toHaveLength(0);
    });

    it('skips the human check when none is configured', async () => {
      registration = build({ humanCheck: null });
      await registration.requestSignupCode(EMAIL, '', client());
      expect(mails).toHaveLength(1);
    });

    it('rejects a wrong code without creating anything, and the right code still works', async () => {
      const code = await signupCode();
      const error = await inputError(() => signup(wrong(code)));
      expect(error.message).toBe('验证码不对或已经过期，请重新获取');
      expect(deps.store.findByUsername('ken')).toBeUndefined();
      await expect(signup(code)).resolves.toMatchObject({ user: { username: 'ken' } });
    });

    it('rejects an expired code, a code for another email, and a code used twice', async () => {
      const code = await signupCode();
      clock += CODE_TTL_MS + 1;
      expect((await inputError(() => signup(code))).message).toContain('验证码不对');

      clock += RESEND_COOLDOWN_MS;
      const other = await signupCode('other@example.com');
      expect((await inputError(() => signup(other))).message).toContain('验证码不对');

      const fresh = await signupCode();
      await signup(fresh);
      await inputError(() => signup(fresh, { username: 'ken2' }));
      expect(deps.store.findByUsername('ken2')).toBeUndefined();
    });

    it('refuses a taken or retired username and keeps the code for another try', async () => {
      await seedUser('ken', null);
      const retired = await seedUser('gone', null);
      deps.store.deleteUser(retired.id);

      const code = await signupCode();
      for (const username of ['ken', 'KEN', 'gone']) {
        expect((await inputError(() => signup(code, { username }))).message).toBe('用户名已经被使用');
      }
      await expect(signup(code, { username: 'ken-lee' })).resolves.toMatchObject({ user: { username: 'ken-lee' } });
    });

    it('refuses reserved and malformed usernames and short passwords', async () => {
      const code = await signupCode();
      for (const username of ['admin', 'Root', 'webmaster']) {
        expect((await inputError(() => signup(code, { username }))).message).toBe('这个用户名不能注册');
      }
      for (const username of ['ab', '-ken', 'ken@home', 'x'.repeat(33), '张三']) {
        expect((await inputError(() => signup(code, { username }))).message).toContain('用户名要 3-32 位');
      }
      expect((await inputError(() => signup(code, { password: 'short' }))).message).toBe('密码至少 8 位');
      expect(deps.store.listUsers()).toHaveLength(0);
    });

    it('stops at the daily cap, not counting accounts the admin opened', async () => {
      registration = build({ config: { ...CONFIG, dailySignupLimit: 1 } });
      deps.store.createUser('opened-by-admin', await hashPassword(PASSWORD), 'user');
      await signup(await signupCode());

      const code = await signupCode('second@example.com');
      const error = await inputError(() => signup(code, { email: 'second@example.com', username: 'second' }));
      expect(error).toBeInstanceOf(AuthInputError);
      expect(error.status).toBe(429);
      expect(error.message).toBe('今天的注册名额已经用完了，明天再来吧');
      expect(deps.store.findByUsername('second')).toBeUndefined();
    });

    it('creates at most 3 accounts per IP per hour', async () => {
      const ip = fixed('203.0.113.7');
      for (const name of ['one', 'two', 'three']) {
        await signup(await signupCode(`${name}@example.com`), { email: `${name}@example.com`, username: name }, ip);
      }
      const code = await signupCode('four@example.com');
      const error = await inputError(() => signup(code, { email: 'four@example.com', username: 'four' }, ip));
      expect(error.status).toBe(429);
      expect(deps.store.findByUsername('four')).toBeUndefined();
    });

    it('limits code guesses to 20 per IP per hour', async () => {
      const ip = fixed('203.0.113.8');
      for (let i = 0; i < 20; i += 1) {
        expect((await inputError(() => signup('000000', {}, ip))).status).toBe(400);
      }
      expect((await inputError(() => signup('000000', {}, ip))).status).toBe(429);
    });

    it('answers a registered email the same way but mails no code', async () => {
      await seedUser('ken', EMAIL);
      await expect(registration.requestSignupCode(EMAIL, TURNSTILE, client())).resolves.toBeUndefined();
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: EMAIL, subject: 'home.example.org：这个邮箱已经注册过了' });
      expect(`${mails[0]?.subject}${mails[0]?.text}`).not.toMatch(/\d{6}/);
      // 冷却也一样占：第二次和没注册的邮箱一样被挡
      const again = await inputError(() => registration.requestSignupCode(EMAIL, TURNSTILE, client()));
      expect(again).toMatchObject({ status: 429, message: '验证码刚发过，等一分钟再重发' });
    });

    it('does not reveal a registered email to someone guessing codes', async () => {
      await seedUser('ken', EMAIL);
      const error = await inputError(() => signup('123456', { username: 'someone' }));
      expect(error.message).toBe('验证码不对或已经过期，请重新获取');
    });

    it('still refuses an email registered after its code was mailed', async () => {
      const code = await signupCode();
      await seedUser('ken', EMAIL);
      const error = await inputError(() => signup(code, { username: 'someone' }));
      expect(error.message).toBe('这个邮箱已经注册过了，直接登录就好');
      expect(deps.store.findByUsername('someone')).toBeUndefined();
    });

    it('enforces the resend cooldown, and a resent code replaces the old one', async () => {
      const first = await signupCode();
      expect((await inputError(() => signupCode())).status).toBe(429);
      expect(mails).toHaveLength(1);
      clock += RESEND_COOLDOWN_MS;
      const second = await signupCode();
      if (first !== second) expect((await inputError(() => signup(first))).message).toContain('验证码不对');
      await expect(signup(second)).resolves.toMatchObject({ user: { username: 'ken' } });
    });

    it('turns a mailer failure into a 503 and logs it', async () => {
      registration = build({ mailer: () => Promise.reject(new Error('resend 500')) });
      const error = await inputError(() => registration.requestSignupCode(EMAIL, TURNSTILE, client()));
      expect(error).toMatchObject({ status: 503, message: '邮件没发出去，请稍后再试' });
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('resend 500'));
    });
  });

  describe('password reset', () => {
    it('resets by code, signs out every device and logs this one in without remember', async () => {
      const user = await seedUser('ken', EMAIL, 'old-password');
      const service = createAuthService(deps);
      const old = await service.login({ username: 'ken', password: 'old-password', remember: true });

      await registration.requestResetCode(EMAIL, TURNSTILE, client());
      const code = codeIn(mails.at(-1));
      expect(mails.at(-1)).toMatchObject({ to: EMAIL, subject: `home.example.org 重设密码验证码：${code}` });

      const result = await registration.completeReset(EMAIL, code, 'new-password', client());
      expect(result).toMatchObject({ remember: false, user: { userId: user.id, username: 'ken' } });
      expect(deps.sessions.resolve(old.token)).toBeUndefined();
      expect(deps.sessions.resolve(result.token)?.userId).toBe(user.id);
      expect(deps.sessions.list(user.id)).toHaveLength(1);
      await expect(service.login({ username: EMAIL, password: 'old-password', remember: false })).rejects.toThrow(AuthInputError);
      await expect(service.login({ username: EMAIL, password: 'new-password', remember: false })).resolves.toBeDefined();
      expect((await inputError(() => registration.completeReset(EMAIL, code, 'third-password', client()))).message).toContain('验证码不对');
    });

    it('says nothing different for an unknown email', async () => {
      await seedUser('ken', EMAIL);
      await expect(registration.requestResetCode('nobody@example.com', TURNSTILE, client())).resolves.toBeUndefined();
      expect(mails).toHaveLength(0);
      const unknown = await inputError(() => registration.completeReset('nobody@example.com', '123456', 'new-password', client()));
      await registration.requestResetCode(EMAIL, TURNSTILE, client());
      const known = await inputError(() => registration.completeReset(EMAIL, wrong(codeIn(mails.at(-1))), 'new-password', client()));
      expect(unknown.message).toBe(known.message);
      expect(unknown.status).toBe(known.status);
      // 没注册的邮箱一样占冷却
      expect((await inputError(() => registration.requestResetCode('nobody@example.com', TURNSTILE, client()))).status).toBe(429);
    });
  });

  describe('email change', () => {
    it('moves the account to a verified new address', async () => {
      const user = await seedUser('ken', EMAIL);
      await registration.requestEmailCode(user.id, ' New@Example.com ');
      const code = codeIn(mails.at(-1));
      expect(mails.at(-1)).toMatchObject({ to: 'new@example.com', subject: `home.example.org 绑定邮箱验证码：${code}` });
      expect((await inputError(() => registration.changeEmail(user.id, 'new@example.com', wrong(code)))).message).toContain('验证码不对');
      expect(registration.changeEmail(user.id, 'NEW@example.com', code)).toBe('new@example.com');
      expect(deps.store.findById(user.id)?.email).toBe('new@example.com');
      expect(deps.store.findByEmail(EMAIL)).toBeUndefined();
    });

    it('refuses the current address and one bound elsewhere', async () => {
      const user = await seedUser('ken', EMAIL);
      await seedUser('amy', 'amy@example.com');
      expect((await inputError(() => registration.requestEmailCode(user.id, EMAIL))).message).toBe('这就是你现在的邮箱');
      expect((await inputError(() => registration.requestEmailCode(user.id, 'AMY@example.com'))).message).toBe('这个邮箱已经绑在别的账号上了');
      expect(mails).toHaveLength(0);
    });

    it('ties the code to the account that asked for it', async () => {
      const ken = await seedUser('ken', EMAIL);
      const amy = await seedUser('amy', null);
      await registration.requestEmailCode(ken.id, 'shared@example.com');
      const code = codeIn(mails.at(-1));
      expect((await inputError(() => registration.changeEmail(amy.id, 'shared@example.com', code))).message).toContain('验证码不对');
      expect(deps.store.findById(amy.id)?.email).toBeNull();
    });
  });

  describe('unlinkIdentity', () => {
    it('lets a password account drop its only identity', async () => {
      const user = await seedUser('ken', EMAIL);
      deps.identities.link(user.id, 'github', '42', 'octo');
      registration.unlinkIdentity(user.id, 'github');
      expect(deps.identities.listByUser(user.id)).toHaveLength(0);
      expect((await inputError(() => registration.unlinkIdentity(user.id, 'github'))).message).toBe('没有绑定这个账号');
    });

    it('always keeps at least one way to log in', async () => {
      const user = await seedUser('octo', null, '');
      deps.identities.link(user.id, 'github', '42', 'octo');
      deps.identities.link(user.id, 'google', 'g-1', 'octo@gmail.com');
      registration.unlinkIdentity(user.id, 'google');
      const error = await inputError(() => registration.unlinkIdentity(user.id, 'github'));
      expect(error.message).toContain('这是你唯一的登录方式');
      expect(deps.identities.listByUser(user.id).map((identity) => identity.provider)).toEqual(['github']);
    });
  });

  describe('completeOAuth login', () => {
    it('creates an account the first time, with no password and an auto username', () => {
      const outcome = registration.completeOAuth(github(), LOGIN, client());
      expect(outcome).toMatchObject({ kind: 'login', created: true, result: { remember: true, user: { username: 'octo' } } });
      if (outcome.kind !== 'login') throw new Error('unreachable');
      const user = deps.store.findById(outcome.result.user.userId);
      expect(user).toMatchObject({ email: 'octo@example.com', displayName: 'Octo Cat', passwordHash: '', signupMethod: 'github' });
      expect(deps.identities.find('github', '42')).toMatchObject({ userId: user?.id, label: 'octo' });
      expect(deps.sessions.resolve(outcome.result.token)?.userId).toBe(user?.id);
    });

    it('logs an existing identity back in and refreshes its label', () => {
      const first = registration.completeOAuth(github(), LOGIN, client());
      const again = registration.completeOAuth(github({ label: 'octo-renamed', email: 'changed@example.com' }), { mode: 'login', remember: false }, client());
      expect(again).toMatchObject({ kind: 'login', created: false, result: { remember: false } });
      if (first.kind !== 'login' || again.kind !== 'login') throw new Error('unreachable');
      expect(again.result.user.userId).toBe(first.result.user.userId);
      expect(deps.identities.find('github', '42')?.label).toBe('octo-renamed');
      expect(deps.store.listUsers()).toHaveLength(1);
    });

    it('never merges into an existing account by email', async () => {
      await seedUser('ken', 'octo@example.com');
      expect(noticeOf(() => registration.completeOAuth(github({ email: 'Octo@Example.com' }), LOGIN, client()))).toBe('oauth-email-taken');
      expect(deps.identities.find('github', '42')).toBeUndefined();
      expect(deps.store.listUsers()).toHaveLength(1);
    });

    it('needs a usable verified email', () => {
      expect(noticeOf(() => registration.completeOAuth(github({ email: null }), LOGIN, client()))).toBe('oauth-no-email');
      expect(noticeOf(() => registration.completeOAuth(github({ email: 'not-an-email' }), LOGIN, client()))).toBe('oauth-no-email');
      expect(deps.store.listUsers()).toHaveLength(0);
    });

    it('steps around taken, retired and reserved names', async () => {
      await seedUser('octo', null);
      const retired = await seedUser('octo2', null);
      deps.store.deleteUser(retired.id);
      const name = (profile: OAuthProfile) => {
        const outcome = registration.completeOAuth(profile, LOGIN, client());
        return outcome.kind === 'login' ? outcome.result.user.username : '';
      };
      expect(name(github())).toBe('octo3');
      expect(name(github({ subject: '43', email: 'a@example.com', usernameHint: 'admin' }))).toBe('admin2');
      expect(name(github({ subject: '44', email: 'b@example.com', usernameHint: 'ab' }))).toBe('user-ab');
      expect(name({ ...github({ subject: 'g-1', email: 'c@example.com', usernameHint: '张三' }), provider: 'google' })).toBe('user');
    });

    it('falls back to a random suffix when base..base9 are all gone', async () => {
      for (const username of ['octo', ...Array.from({ length: 8 }, (_, i) => `octo${i + 2}`)]) await seedUser(username, null);
      const outcome = registration.completeOAuth(github(), LOGIN, client());
      expect(outcome.kind === 'login' && outcome.result.user.username).toMatch(/^octo-[0-9a-f]{6}$/);
    });

    it('drops an unusable display name instead of failing', () => {
      const outcome = registration.completeOAuth(github({ displayName: `a${String.fromCodePoint(0x200b)}b` }), LOGIN, client());
      expect(outcome.kind === 'login' && outcome.result.user.displayName).toBeNull();
    });

    it('respects the daily cap and the per-IP create limit', async () => {
      const capped = build({ config: { ...CONFIG, dailySignupLimit: 1 } });
      await seedUser('ken', EMAIL);
      expect(noticeOf(() => capped.completeOAuth(github(), LOGIN, client()))).toBe('signup-closed');

      const ip = fixed('203.0.113.9');
      for (const n of [1, 2, 3]) registration.completeOAuth(github({ subject: `s${n}`, email: `s${n}@example.com` }), LOGIN, ip);
      expect(noticeOf(() => registration.completeOAuth(github({ subject: 's4', email: 's4@example.com' }), LOGIN, ip))).toBe('signup-rate');
      expect(deps.identities.find('github', 's4')).toBeUndefined();
    });
  });

  describe('completeOAuth link', () => {
    it('links to the signed-in account and fills a missing email', async () => {
      const user = await seedUser('ken', null);
      expect(registration.completeOAuth(github(), { mode: 'link', userId: user.id }, client())).toEqual({ kind: 'linked' });
      expect(deps.identities.find('github', '42')?.userId).toBe(user.id);
      expect(deps.store.findById(user.id)?.email).toBe('octo@example.com');
      expect(deps.store.listUsers()).toHaveLength(1);
    });

    it('keeps an existing email, and never takes one another account uses', async () => {
      const ken = await seedUser('ken', EMAIL);
      const amy = await seedUser('amy', null);
      await seedUser('octo', 'octo@example.com');
      registration.completeOAuth(github(), { mode: 'link', userId: ken.id }, client());
      registration.completeOAuth(github({ provider: 'google', subject: 'g-1' }), { mode: 'link', userId: amy.id }, client());
      expect(deps.store.findById(ken.id)?.email).toBe(EMAIL);
      expect(deps.store.findById(amy.id)?.email).toBeNull();
    });

    it('relinking the same identity only refreshes the label', async () => {
      const user = await seedUser('ken', EMAIL);
      registration.completeOAuth(github(), { mode: 'link', userId: user.id }, client());
      expect(registration.completeOAuth(github({ label: 'octo-new' }), { mode: 'link', userId: user.id }, client())).toEqual({ kind: 'linked' });
      expect(deps.identities.listByUser(user.id)).toHaveLength(1);
      expect(deps.identities.find('github', '42')?.label).toBe('octo-new');
    });

    it('rejects an identity owned by someone else, and a second account of the same provider', async () => {
      const ken = await seedUser('ken', EMAIL);
      const amy = await seedUser('amy', null);
      registration.completeOAuth(github(), { mode: 'link', userId: ken.id }, client());
      expect(noticeOf(() => registration.completeOAuth(github(), { mode: 'link', userId: amy.id }, client()))).toBe('oauth-linked-elsewhere');
      expect(noticeOf(() => registration.completeOAuth(github({ subject: '99' }), { mode: 'link', userId: ken.id }, client()))).toBe(
        'oauth-already-linked',
      );
      expect(deps.identities.find('github', '42')?.userId).toBe(ken.id);
      expect(deps.identities.find('github', '99')).toBeUndefined();
    });
  });
});
