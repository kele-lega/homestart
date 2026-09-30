/**
 * 每个用户绑定的 Steam 账号：一个 JSON 文件 { 用户名: SteamID64 }。
 * 路径取环境变量 STEAM_USERS_FILE，默认是工作目录下的 data/steam-users.json；读写规则见 ../user-store
 */
import { createUserStore, settingsFilePath, type UserStore } from '../user-store';
import { isSteamId64 } from './steam-id';

export const DEFAULT_STEAM_USERS_FILE = 'data/steam-users.json';

/** 设置文件的绝对路径；相对路径按当前工作目录解析 */
export function steamUsersFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'STEAM_USERS_FILE', DEFAULT_STEAM_USERS_FILE);
}

/** 设置文件不是 JSON 对象 */
export class SteamStoreError extends Error {
  constructor() {
    super('Steam 设置文件格式有误');
    this.name = 'SteamStoreError';
  }
}

export interface SteamStoreOptions {
  /** 测试时注入；默认每次调用都按环境变量取路径 */
  readonly filePath?: () => string;
}

/** get 返回 SteamID64；不是个人账号 SteamID64 的条目读作未绑定 */
export function createSteamStore(options: SteamStoreOptions = {}): UserStore {
  return createUserStore({
    filePath: options.filePath ?? (() => steamUsersFilePath()),
    parse: (value) => (isSteamId64(value) ? value : undefined),
    formatError: () => new SteamStoreError(),
    log: { label: 'steam', message: 'Steam 设置文件读不懂，所有用户按未绑定处理' },
  });
}
