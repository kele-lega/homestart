/**
 * 每个用户的个人偏好：一个 JSON 文件 { 用户名: { Widget 类型: 偏好 } }。
 * 路径取环境变量 PREFERENCES_FILE，默认是工作目录下的 data/preferences.json；读写规则见 ./user-store。
 * 页面、server island、Widget 操作都经 loadConfigFor 拿到合并了偏好的配置，三处看到的永远一致。
 * 账号存过自己的网站导航（adapters/user-links）时，配置里的 links 也换成它的
 */
import { ANONYMOUS } from '../core/api';
import type { AppConfig } from '../core/config';
import { ActionInputError } from '../core/widget';
import type { Registry } from '../core/layout';
import { logBackgroundError } from '../core/log';
import { applyPatch, parsePreferences, personalize, type Preferences, type PreferencesPatch } from '../core/preferences';
import { registry as defaultRegistry } from '../core/registry';
import { loadConfig as defaultLoadConfig } from '../core/runtime';
import { toLinksConfig, type UserLinks } from '../core/user-links';
import { readUserLinks } from './user-links';
import { createUserStore, settingsFilePath, type UserStore } from './user-store';

export const DEFAULT_PREFERENCES_FILE = 'data/preferences.json';

export function preferencesFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'PREFERENCES_FILE', DEFAULT_PREFERENCES_FILE);
}

/** 设置文件不是 JSON 对象 */
export class PreferencesStoreError extends Error {
  constructor() {
    super('偏好设置文件格式有误');
    this.name = 'PreferencesStoreError';
  }
}

/** 条目原样存取（只要求是对象），逐项校验在读出来之后：注册表改了，旧条目也不会被写入时丢掉 */
export function createPreferencesStore(filePath: () => string = () => preferencesFilePath()): UserStore<Preferences> {
  return createUserStore<Preferences>({
    filePath,
    parse: (value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Preferences) : undefined),
    formatError: () => new PreferencesStoreError(),
    log: { label: 'preferences', message: '偏好设置文件读不懂，所有用户按默认设置处理' },
  });
}

export interface PreferencesService {
  /** 校验过的偏好；匿名、没设置、读不出来都是 {} */
  read(user: string): Promise<Preferences>;
  /** 改动不合格时抛 ActionInputError；返回合并后的全部偏好 */
  update(user: string, patch: PreferencesPatch): Promise<Preferences>;
  /** 合并了这个用户偏好的配置；偏好读不出来时退回默认配置，不让整页失败 */
  configFor(user: string): Promise<AppConfig>;
}

export interface PreferencesDeps {
  readonly store?: UserStore<Preferences>;
  readonly registry?: Registry;
  readonly loadConfig?: () => Promise<AppConfig>;
  /** 账号自己的网站导航；没存过返回 undefined */
  readonly readLinks?: (user: string) => Promise<UserLinks | undefined>;
}

export function createPreferencesService(deps: PreferencesDeps = {}): PreferencesService {
  const {
    store = createPreferencesStore(),
    registry = defaultRegistry,
    loadConfig = defaultLoadConfig,
    readLinks = readUserLinks,
  } = deps;
  // 读-改-写整段排队：同一进程里两张卡片同时保存，不会一张盖掉另一张
  let queue: Promise<unknown> = Promise.resolve();

  async function read(user: string): Promise<Preferences> {
    if (user === ANONYMOUS) return {};
    return parsePreferences(await store.get(user), registry);
  }

  async function write(user: string, patch: PreferencesPatch): Promise<Preferences> {
    // 存的是原始条目：暂时读不懂（比如对应的 Widget 被删了）的那几项照样留着
    const raw = (await store.get(user)) ?? {};
    const result = applyPatch(raw, patch, registry);
    if (!result.ok) throw new ActionInputError(result.message);
    await store.put(user, Object.keys(result.next).length > 0 ? result.next : undefined);
    return parsePreferences(result.next, registry);
  }

  return {
    read,
    update(user, patch) {
      if (user === ANONYMOUS) return Promise.reject(new ActionInputError('未登录，无法保存设置'));
      const task = queue.then(() => write(user, patch));
      queue = task.catch(() => undefined);
      return task;
    },
    async configFor(user) {
      const config = await loadConfig();
      const [preferences, links] = await Promise.all([
        read(user).catch((error: unknown) => {
          logBackgroundError('preferences', `${user} 的偏好读取失败，按默认设置显示`, error);
          return {};
        }),
        readLinks(user).catch((error: unknown) => {
          logBackgroundError('user-links', `${user} 的网站导航读取失败，按 links.yaml 显示`, error);
          return undefined;
        }),
      ]);
      const personalized = personalize(config, preferences, registry);
      return links ? { ...personalized, links: toLinksConfig(links, config.links) } : personalized;
    },
  };
}

const defaultService = createPreferencesService();

export const readPreferences = (user: string) => defaultService.read(user);
export const updatePreferences = (user: string, patch: PreferencesPatch) => defaultService.update(user, patch);
export const loadConfigFor = (user: string) => defaultService.configFor(user);
