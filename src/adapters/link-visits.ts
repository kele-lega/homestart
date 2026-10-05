/**
 * 每个用户最近点开过的网站：一个 JSON 文件 { 用户名: [网址, …] }，最近的在前。常用网站按它排。
 * 路径取环境变量 LINK_VISITS_FILE，默认是工作目录下的 data/link-visits.json；读写规则见 ./user-store
 */
import { ANONYMOUS } from '../core/api';
import { createUserStore, settingsFilePath, type UserStore } from './user-store';

export const DEFAULT_LINK_VISITS_FILE = 'data/link-visits.json';
/** 每人留多少条：常用网站只显示几个，多留一些，links.yaml 删掉几条链接后仍然排得出来 */
export const MAX_VISITS = 20;

export function linkVisitsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'LINK_VISITS_FILE', DEFAULT_LINK_VISITS_FILE);
}

export class LinkVisitsStoreError extends Error {
  constructor() {
    super('网站点击记录文件格式有误');
    this.name = 'LinkVisitsStoreError';
  }
}

/** 只留字符串条目，最多 MAX_VISITS 条 */
function parseVisits(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string').slice(0, MAX_VISITS);
}

export function createLinkVisitsStore(filePath: () => string = () => linkVisitsFilePath()): UserStore<readonly string[]> {
  return createUserStore<readonly string[]>({
    filePath,
    parse: parseVisits,
    formatError: () => new LinkVisitsStoreError(),
    log: { label: 'link-visits', message: '网站点击记录文件读不懂，常用网站按配置顺序显示' },
  });
}

/** 把刚点的网址挪到最前面，去重并截断 */
export function withVisit(visits: readonly string[], url: string): readonly string[] {
  return [url, ...visits.filter((item) => item !== url)].slice(0, MAX_VISITS);
}

export interface LinkVisitsService {
  /** 最近点开过的网址，最近的在前；匿名、没记录、读不出来都是 [] */
  recent(user: string): Promise<readonly string[]>;
  record(user: string, url: string): Promise<void>;
}

export function createLinkVisitsService(store: UserStore<readonly string[]> = createLinkVisitsStore()): LinkVisitsService {
  // 读-改-写整段排队：连着点开几个网站，后一次不会盖掉前一次
  let queue: Promise<unknown> = Promise.resolve();

  return {
    async recent(user) {
      if (user === ANONYMOUS) return [];
      return (await store.get(user)) ?? [];
    },
    record(user, url) {
      if (user === ANONYMOUS) return Promise.resolve();
      const task = queue.then(async () => store.put(user, withVisit((await store.get(user)) ?? [], url)));
      queue = task.catch(() => undefined);
      return task;
    },
  };
}

const defaultService = createLinkVisitsService();

export const recentVisits = (user: string) => defaultService.recent(user);
export const recordVisit = (user: string, url: string) => defaultService.record(user, url);
