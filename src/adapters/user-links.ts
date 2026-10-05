/**
 * 每个账号自己的网站导航：一个 JSON 文件 { 用户名: { categories: [...] } }。
 * 路径取环境变量 USER_LINKS_FILE，默认是工作目录下的 data/user-links.json；读写规则见 ./user-store。
 * 没存过的账号（和匿名访客）用 links.yaml
 */
import { ANONYMOUS } from '../core/api';
import { parseUserLinks, type UserLinks } from '../core/user-links';
import { ActionInputError } from '../core/widget';
import { createUserStore, settingsFilePath, type UserStore } from './user-store';

export const DEFAULT_USER_LINKS_FILE = 'data/user-links.json';

export function userLinksFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'USER_LINKS_FILE', DEFAULT_USER_LINKS_FILE);
}

export class UserLinksStoreError extends Error {
  constructor() {
    super('网站导航文件格式有误');
    this.name = 'UserLinksStoreError';
  }
}

export function createUserLinksStore(filePath: () => string = () => userLinksFilePath()): UserStore<UserLinks> {
  return createUserStore<UserLinks>({
    filePath,
    parse: parseUserLinks,
    formatError: () => new UserLinksStoreError(),
    log: { label: 'user-links', message: '网站导航文件读不懂，所有用户按 links.yaml 显示' },
  });
}

export interface UserLinksService {
  /** 存过的导航；匿名、没存过、读不懂都是 undefined */
  read(user: string): Promise<UserLinks | undefined>;
  /** value 必须已经校验过；undefined 恢复成 links.yaml */
  write(user: string, value: UserLinks | undefined): Promise<void>;
}

export function createUserLinksService(store: UserStore<UserLinks> = createUserLinksStore()): UserLinksService {
  return {
    async read(user) {
      if (user === ANONYMOUS) return undefined;
      return store.get(user);
    },
    async write(user, value) {
      if (user === ANONYMOUS) throw new ActionInputError('未登录，无法保存导航');
      await store.put(user, value);
    },
  };
}

const defaultService = createUserLinksService();

export const readUserLinks = (user: string) => defaultService.read(user);
export const writeUserLinks = (user: string, value: UserLinks | undefined) => defaultService.write(user, value);
