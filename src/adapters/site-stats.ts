/**
 * 本站的导航、搜索次数：一个 JSON 文件 { nav, search }。路径取环境变量 SITE_STATS_FILE，默认是工作目录下的 data/site-stats.json。
 * 计数每次请求都要加一，不能每次都现读现写：第一次用到时读一次文件，之后以内存里的数为准，
 * 写入排队执行，正在写的时候进来的点击攒着，下一次一起写（先写临时文件再 rename，见 ./user-store）。
 * 文件读不懂时不覆盖它：点击先攒在内存里，页面上照样在涨，每次写之前再试着读一次。
 * 计数变了会通知订阅的人（/api/site/stream 推给开着首页的浏览器）：一阵点击合成一次，最多每 NOTIFY_MS 推一次
 */
import { readFile } from 'node:fs/promises';
import { logBackgroundError } from '../core/log';
import { HIT_KINDS, ZERO_COUNTS, type HitKind, type SiteCounts } from '../lib/site-stats';
import { settingsFilePath, writeAtomic } from './user-store';

export const DEFAULT_SITE_STATS_FILE = 'data/site-stats.json';

export function siteStatsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return settingsFilePath(env, 'SITE_STATS_FILE', DEFAULT_SITE_STATS_FILE);
}

export class SiteStatsStoreError extends Error {
  constructor() {
    super('访问计数文件格式有误');
    this.name = 'SiteStatsStoreError';
  }
}

const BOM = 0xfeff;

/** 文件里缺的、不是非负整数的那一项按 0 算；整个不是 JSON 对象才算读不懂 */
export function parseSiteCounts(raw: unknown): SiteCounts | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Partial<Record<HitKind, unknown>>;
  const count = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);
  return { nav: count(record.nav), search: count(record.search) };
}

async function readSaved(file: string): Promise<SiteCounts | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ZERO_COUNTS;
    throw error;
  }
  try {
    return parseSiteCounts(JSON.parse(text.charCodeAt(0) === BOM ? text.slice(1) : text));
  } catch {
    // JSON.parse 的错误消息会带上一段文件内容，不往外传
    return undefined;
  }
}

const add = (a: SiteCounts, b: SiteCounts): SiteCounts => ({ nav: a.nav + b.nav, search: a.search + b.search });
const isZero = (counts: SiteCounts) => HIT_KINDS.every((kind) => counts[kind] === 0);

/** 合并通知的间隔：同一时刻很多人点击时，每个打开的页面每秒最多收到几次 */
export const NOTIFY_MS = 100;

export interface SiteStatsService {
  /** 文件里的数加上还没写进去的 */
  counts(): Promise<SiteCounts>;
  /** 加一，返回加完以后的计数；写文件在后台排队，不等它 */
  hit(kind: HitKind): Promise<SiteCounts>;
  /** 等排队的写入都写完；测试用 */
  flush(): Promise<void>;
  /** 计数变了时（合并一阵以后）收到最新的计数；返回取消订阅 */
  subscribe(listener: (counts: SiteCounts) => void): () => void;
}

export interface SiteStatsDeps {
  readonly filePath?: () => string;
  readonly notifyMs?: number;
}

export function createSiteStatsService({
  filePath = () => siteStatsFilePath(),
  notifyMs = NOTIFY_MS,
}: SiteStatsDeps = {}): SiteStatsService {
  /** 已经写进（或正在写进）文件的数；文件还没读过、读不懂时是 undefined */
  let saved: SiteCounts | undefined;
  /** 还没开始写的点击 */
  let pending: SiteCounts = ZERO_COUNTS;
  let queue: Promise<void> = Promise.resolve();
  let scheduled = false;
  // 文件读不懂、写不进去时每次点击都会碰到，只记一次，成功一次后重新计
  let reported = false;

  function report(message: string, error: unknown): void {
    if (!reported) logBackgroundError('site-stats', message, error);
    reported = true;
  }

  /** 同一时刻只读一次：几个请求一起进来时，晚读完的不会拿旧文件盖掉刚加上的数 */
  let loading: Promise<void> | undefined;

  function load(): Promise<void> {
    if (saved) return Promise.resolve();
    loading ??= (async () => {
      try {
        saved = await readSaved(filePath());
        if (!saved) report('访问计数文件读不懂，先不写入，点击记在内存里', new SiteStatsStoreError());
      } catch (error) {
        report('访问计数文件读取失败，先不写入，点击记在内存里', error);
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  }

  async function write(): Promise<void> {
    await load();
    if (!saved || isZero(pending)) return;
    const delta = pending;
    const before = saved;
    saved = add(before, delta);
    pending = ZERO_COUNTS;
    try {
      await writeAtomic(filePath(), `${JSON.stringify(saved)}\n`);
      reported = false;
    } catch (error) {
      // 没写进去：退回去，下一次点击时连同这些一起再写
      saved = before;
      pending = add(pending, delta);
      report('访问计数写入失败，下一次点击时重试', error);
    }
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    // 开始写的时候才把标记放下：写的过程中进来的点击会再排一次，一起写进下一次
    queue = queue.then(() => {
      scheduled = false;
      return write();
    });
  }

  const current = () => add(saved ?? ZERO_COUNTS, pending);

  const listeners = new Set<(counts: SiteCounts) => void>();
  let notifying: ReturnType<typeof setTimeout> | undefined;

  function notify(): void {
    if (notifying || listeners.size === 0) return;
    notifying = setTimeout(() => {
      notifying = undefined;
      const counts = current();
      for (const listener of listeners) {
        try {
          listener(counts);
        } catch {
          // 一个连接出错不影响别的连接
        }
      }
    }, notifyMs);
    // 等着推送的计时器不拦着进程退出
    notifying.unref?.();
  }

  return {
    async counts() {
      await load();
      return current();
    },
    async hit(kind) {
      pending = { ...pending, [kind]: pending[kind] + 1 };
      schedule();
      await load();
      notify();
      return current();
    },
    flush: () => queue,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const defaultService = createSiteStatsService();

export const siteCounts = () => defaultService.counts();
export const recordHit = (kind: HitKind) => defaultService.hit(kind);
export const subscribeCounts = (listener: (counts: SiteCounts) => void) => defaultService.subscribe(listener);
