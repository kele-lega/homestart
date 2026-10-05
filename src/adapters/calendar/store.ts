/**
 * 每个用户的日历订阅地址：一个 JSON 文件 { 用户名: 地址 }，与旧 ical-proxy 的 users.json 格式相同，可以直接沿用。
 * 路径取环境变量 CALENDAR_USERS_FILE，默认是工作目录下的 data/calendar-users.json。
 * 订阅地址等同于访问凭据；读写规则（现读、原子写入、权限、保留读不懂的条目）见 ../user-store
 */
import { createUserStore, settingsFilePath, stringEntry, type UserStore } from '../user-store';
import { checkUrlSyntax } from './url-guard';

export const DEFAULT_USERS_FILE = 'data/calendar-users.json';

/** 设置文件的绝对路径；相对路径按当前工作目录解析 */
export function usersFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'CALENDAR_USERS_FILE', DEFAULT_USERS_FILE);
}

/** 设置文件不是 JSON 对象。消息里不带文件内容（里面是订阅地址） */
export class CalendarStoreError extends Error {
  constructor() {
    super('日历设置文件格式有误');
    this.name = 'CalendarStoreError';
  }
}

/** get 返回规范化后的订阅地址（href） */
export type CalendarStore = UserStore;

export interface CalendarStoreOptions {
  /** 测试时注入；默认每次调用都按环境变量取路径 */
  readonly filePath?: () => string;
}

function normalizeUrl(value: string): string | undefined {
  const check = checkUrlSyntax(value);
  return check.ok ? check.url.href : undefined;
}

export function createCalendarStore(options: CalendarStoreOptions = {}): CalendarStore {
  return createUserStore({
    filePath: options.filePath ?? (() => usersFilePath()),
    parse: stringEntry(normalizeUrl),
    formatError: () => new CalendarStoreError(),
    log: { label: 'calendar', message: '日历设置文件读不懂，所有用户按未配置处理' },
  });
}
