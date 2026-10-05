/**
 * 个人中心在服务端和浏览器之间传的数据形状，以及两边都要用的显示规则（设备名、时间、头像地址）。
 * 这个模块会进浏览器，不能引用服务端代码
 */
import type { Provider } from '../adapters/auth/identities';
import type { Role, SignupMethod } from '../adapters/auth/store';
import { localDateKey, localTimeText } from './zoned-time';

export type { Provider, Role, SignupMethod };

export const PROVIDER_LABELS: Readonly<Record<Provider, string>> = { github: 'GitHub', google: 'Google' };

export const SIGNUP_METHOD_LABELS: Readonly<Record<SignupMethod, string>> = {
  admin: '管理员开通',
  password: '邮箱注册',
  github: 'GitHub 注册',
  google: 'Google 注册',
};

export interface LoginStampView {
  readonly at: number;
  readonly ip: string | null;
}

/** 头像：image 是自己上传的图（站内地址），没有就按 seed 画默认的色块图（lib/identicon） */
export interface AvatarView {
  readonly seed: string;
  readonly image: string | null;
}

/** 绑定的第三方账号；label 是对方那边的登录名或邮箱，只用来认出是哪一个 */
export interface IdentityView {
  readonly provider: Provider;
  readonly label: string;
  readonly createdAt: number;
}

export interface AccountView {
  readonly id: number;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatar: AvatarView;
  readonly role: Role;
  readonly createdAt: number;
  readonly previousLogin: LoginStampView | null;
  readonly email: string | null;
  readonly signupMethod: SignupMethod;
  /** 只用第三方登录的账号没有密码：改密码那里变成「设置密码」，不用填当前密码 */
  readonly hasPassword: boolean;
  readonly identities: readonly IdentityView[];
}

/**
 * 服务端开了哪些登录 / 注册方式：没配好的第三方不显示按钮；没配发信（email: false）就不能用邮箱注册、找回密码、改邮箱。
 * turnstileSiteKey 是 Cloudflare Turnstile 的站点密钥（公开的），没配人机验证时为 null，表单里就不放小部件
 */
export interface LoginOptionsView {
  readonly providers: readonly Provider[];
  readonly email: boolean;
  readonly turnstileSiteKey: string | null;
}

/**
 * 第三方登录回来、或者别的整页跳转之后，页面顶上要提示的一句话：跳转地址带 ?notice=<代码>，页面按代码查这张表。
 * 只认表里有的代码，地址栏里随便填的字不会原样显示出来
 */
export const NOTICES = {
  'oauth-denied': { kind: 'error', text: '没有完成授权，什么也没改' },
  'oauth-expired': { kind: 'error', text: '登录流程超时或已经用过了，请重新点一次' },
  'oauth-failed': { kind: 'error', text: '没能从对方那里取到账号信息，请稍后再试' },
  'oauth-unavailable': { kind: 'error', text: '本站没有开启这种登录方式' },
  'oauth-no-email': { kind: 'error', text: '这个第三方账号没有验证过的邮箱，不能用来注册；请先在对方那里验证邮箱，或用邮箱注册' },
  'oauth-email-taken': {
    kind: 'error',
    text: '这个邮箱已经注册过本站账号：请先用原来的方式登录，再到个人中心「登录方式」里绑定',
  },
  'oauth-linked-elsewhere': { kind: 'error', text: '这个第三方账号已经绑在本站另一个账号上了' },
  'oauth-already-linked': { kind: 'error', text: '这个账号已经绑过同一家的另一个账号，先解绑再绑新的' },
  'oauth-linked': { kind: 'ok', text: '绑定好了，下次可以直接用它登录' },
  'signup-closed': { kind: 'error', text: '今天的注册名额已经用完了，明天再来吧' },
  'signup-rate': { kind: 'error', text: '尝试太频繁，请稍后再试' },
  welcome: { kind: 'ok', text: '注册好了。用户名是自动起的，不能改；想用密码登录，在下面「改密码」里设一个' },
} as const satisfies Record<string, { readonly kind: 'ok' | 'error'; readonly text: string }>;

export type NoticeCode = keyof typeof NOTICES;
export type NoticeView = (typeof NOTICES)[NoticeCode];

export function noticeOf(code: string | null | undefined): NoticeView | undefined {
  return code && Object.hasOwn(NOTICES, code) ? NOTICES[code as NoticeCode] : undefined;
}

/** 「登录设备」的一行；原始 User-Agent 不下发，只给整理过的设备名 */
export interface SessionView {
  readonly id: number;
  readonly device: string;
  readonly ip: string | null;
  readonly remember: boolean;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly current: boolean;
}

export interface SessionSource {
  readonly id: number;
  readonly userAgent: string | null;
  readonly ip: string | null;
  readonly remember: boolean;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export function toSessionView(session: SessionSource, currentSessionId: number): SessionView {
  const { id, userAgent, ip, remember, createdAt, lastSeenAt } = session;
  return { id, device: describeDevice(userAgent), ip, remember, createdAt, lastSeenAt, current: id === currentSessionId };
}

/** 管理员看到的账号列表：只有最近登录的时间，不给别人的 IP */
export interface UserView {
  readonly id: number;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatar: AvatarView;
  readonly role: Role;
  readonly createdAt: number;
  readonly lastLoginAt: number | null;
  readonly email: string | null;
  readonly signupMethod: SignupMethod;
}

export interface UserSource {
  readonly id: number;
  readonly username: string;
  readonly displayName: string | null;
  readonly role: Role;
  readonly createdAt: number;
  readonly lastLogin: LoginStampView | null;
  readonly email: string | null;
  readonly signupMethod: SignupMethod;
  readonly avatarSeed: string;
  readonly avatarFile: string | null;
}

/** 上传的头像经 /avatars/<文件名> 提供（pages/avatars/[file].ts） */
export const avatarOf = (user: Pick<UserSource, 'avatarSeed' | 'avatarFile'>): AvatarView => ({
  seed: user.avatarSeed,
  image: user.avatarFile ? `/avatars/${user.avatarFile}` : null,
});

export function toUserView(user: UserSource): UserView {
  const { id, username, displayName, role, createdAt, lastLogin, email, signupMethod } = user;
  return {
    id,
    username,
    displayName,
    avatar: avatarOf(user),
    role,
    createdAt,
    lastLoginAt: lastLogin?.at ?? null,
    email,
    signupMethod,
  };
}

// 顺序有讲究：Edge、Opera 的 UA 里也有 Chrome，Chrome 的 UA 里也有 Safari
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

// iPadOS 13 起默认报成 Macintosh，只能认出明确写了 iPad 的；Android 的 UA 里也有 Linux
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPad/, 'iPad'],
  [/iPhone|iPod/, 'iPhone'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const match = (ua: string, table: readonly (readonly [RegExp, string])[]) => table.find(([pattern]) => pattern.test(ua))?.[1];

/** 「Chrome · Windows」这样的设备名；认不出来的部分省略，都认不出来就是「未知设备」 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return '未知设备';
  const parts = [match(userAgent, BROWSERS), match(userAgent, SYSTEMS)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '未知设备';
}

/** 站点时区里的「2026.09.30 14:05」；服务端和浏览器算出来的一样，注水时不会对不上 */
export function formatWhen(ms: number, timeZone: string): string {
  return `${localDateKey(ms, timeZone).replaceAll('-', '.')} ${localTimeText(ms, timeZone)}`;
}
