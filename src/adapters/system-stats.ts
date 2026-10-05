import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';

/**
 * 本机的 CPU、内存、存储：只读 os 模块、/proc/meminfo 和 statfs，不开子进程。
 * CPU 占用要两次采样做差：每次读取都留下这一次的计数，下一次（服务器版块每几秒轮询一回）拿它当起点；
 * 起点太旧或没有时，当场隔一小段再采一次
 */

export interface CpuStats {
  /** 型号，例如 Intel Xeon E5-2682 v4；虚拟机里可能拿不到 */
  readonly model: string | undefined;
  readonly cores: number;
  /** 0–1 */
  readonly usage: number;
  /** 1 / 5 / 15 分钟平均负载 */
  readonly load: readonly [number, number, number];
}

export interface MemoryStats {
  readonly total: number;
  /** 程序实际占用：总量减去可用（可用里含能随时回收的缓存），和 free 的 used 一致 */
  readonly used: number;
  readonly available: number;
  /** buff/cache；拿不到 /proc/meminfo 时没有 */
  readonly cache: number | undefined;
  /** 没开交换分区时没有 */
  readonly swap: { readonly total: number; readonly used: number } | undefined;
}

export interface DiskStats {
  readonly mount: string;
  readonly total: number;
  readonly used: number;
  /** 普通用户还能写入的空间（不含 root 保留块），和 df 的 Avail 一致 */
  readonly available: number;
}

export interface SystemStats {
  readonly cpu: CpuStats;
  readonly memory: MemoryStats;
  readonly disk: DiskStats;
  /** 开机到现在的秒数 */
  readonly uptime: number;
}

/** 所有核心累计的忙碌 / 总时间（毫秒） */
interface CpuTimes {
  readonly busy: number;
  readonly total: number;
}

interface CpuInfo {
  readonly model: string;
  readonly times: { readonly user: number; readonly nice: number; readonly sys: number; readonly idle: number; readonly irq: number };
}

interface FsInfo {
  readonly bsize: number;
  readonly blocks: number;
  readonly bfree: number;
  readonly bavail: number;
}

export interface SystemDeps {
  readonly cpus: () => readonly CpuInfo[];
  readonly loadavg: () => number[];
  readonly uptime: () => number;
  /** /proc/meminfo 的内容；读不到（非 Linux）时抛错，退回 os.totalmem / freemem */
  readonly meminfo: () => Promise<string>;
  readonly totalmem: () => number;
  readonly freemem: () => number;
  readonly statfs: (path: string) => Promise<FsInfo>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

const systemDeps: SystemDeps = {
  cpus: () => os.cpus(),
  loadavg: () => os.loadavg(),
  uptime: () => os.uptime(),
  meminfo: () => readFile('/proc/meminfo', 'utf8'),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  statfs: (path) => statfs(path),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** 上一次采样在这个范围内才拿来做差：太近了数字跳得厉害，太远了只是很久以前的平均值 */
const BASELINE_MIN_MS = 1_000;
const BASELINE_MAX_MS = 60_000;
/** 没有可用的起点时当场补采，间隔短到不拖慢接口 */
const SAMPLE_MS = 250;
/** 几个管理员同时开着页面也只算一次 */
const FRESH_MS = 1_000;

function cpuTimes(cpus: readonly CpuInfo[]): CpuTimes {
  let busy = 0;
  let total = 0;
  for (const { times } of cpus) {
    const sum = times.user + times.nice + times.sys + times.idle + times.irq;
    busy += sum - times.idle;
    total += sum;
  }
  return { busy, total };
}

/** 两次计数之间的忙碌比例；核心数变了（热插拔）或计数没动时返回 undefined */
function usageBetween(from: CpuTimes, to: CpuTimes): number | undefined {
  const total = to.total - from.total;
  const busy = to.busy - from.busy;
  if (total <= 0 || busy < 0) return undefined;
  return Math.min(1, busy / total);
}

/** 「Intel(R) Xeon(R) CPU E5-2682 v4 @ 2.50GHz」→「Intel Xeon E5-2682 v4 @ 2.50GHz」 */
export function cleanModel(model: string): string | undefined {
  const cleaned = model
    .replace(/\((?:R|TM|tm)\)/g, '')
    .replace(/\bCPU\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}

/** meminfo 的「键: 数值 kB」→ 字节；不带 kB 的是个数（大页数量之类），原样保留 */
export function parseMeminfo(text: string): ReadonlyMap<string, number> {
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^(\w+(?:\(\w+\))?):\s+(\d+)(\s+kB)?$/.exec(line.trim());
    if (match) values.set(match[1]!, Number(match[2]) * (match[3] ? 1024 : 1));
  }
  return values;
}

async function readMemory(deps: SystemDeps): Promise<MemoryStats> {
  const info = await deps.meminfo().then(parseMeminfo, () => undefined);
  const total = info?.get('MemTotal');
  if (!info || !total) {
    const fallbackTotal = deps.totalmem();
    const available = Math.min(deps.freemem(), fallbackTotal);
    return { total: fallbackTotal, used: fallbackTotal - available, available, cache: undefined, swap: undefined };
  }
  const cache = (info.get('Buffers') ?? 0) + (info.get('Cached') ?? 0) + (info.get('SReclaimable') ?? 0);
  // 老内核没有 MemAvailable，按 free + 缓存估算
  const available = Math.min(total, info.get('MemAvailable') ?? (info.get('MemFree') ?? 0) + cache);
  const swapTotal = info.get('SwapTotal') ?? 0;
  const swap = swapTotal > 0 ? { total: swapTotal, used: swapTotal - (info.get('SwapFree') ?? 0) } : undefined;
  return { total, used: total - available, available, cache, swap };
}

async function readDisk(deps: SystemDeps, mount: string): Promise<DiskStats> {
  const { bsize, blocks, bfree, bavail } = await deps.statfs(mount);
  return { mount, total: blocks * bsize, used: (blocks - bfree) * bsize, available: bavail * bsize };
}

export interface SystemStatsReader {
  readonly read: () => Promise<SystemStats>;
}

export function createSystemStats(overrides: Partial<SystemDeps> = {}, mount = '/'): SystemStatsReader {
  const deps: SystemDeps = { ...systemDeps, ...overrides };
  let baseline: { readonly at: number; readonly times: CpuTimes } | undefined;
  let latest: { readonly at: number; readonly stats: Promise<SystemStats> } | undefined;

  /** 占用比例，连同这一次采到的核心列表（型号、核数从它取） */
  async function sampleCpu(): Promise<{ readonly usage: number; readonly cpus: readonly CpuInfo[] }> {
    let from = baseline;
    const at = deps.now();
    if (!from || at - from.at < BASELINE_MIN_MS || at - from.at > BASELINE_MAX_MS) {
      from = { at, times: cpuTimes(deps.cpus()) };
      await deps.sleep(SAMPLE_MS);
    }
    const cpus = deps.cpus();
    const current = { at: deps.now(), times: cpuTimes(cpus) };
    baseline = current;
    return { usage: usageBetween(from.times, current.times) ?? 0, cpus };
  }

  async function collect(): Promise<SystemStats> {
    const [{ usage, cpus }, memory, disk] = await Promise.all([sampleCpu(), readMemory(deps), readDisk(deps, mount)]);
    const [one = 0, five = 0, fifteen = 0] = deps.loadavg();
    const cpu: CpuStats = { model: cleanModel(cpus[0]?.model ?? ''), cores: cpus.length, usage, load: [one, five, fifteen] };
    return { cpu, memory, disk, uptime: deps.uptime() };
  }

  return {
    read() {
      const at = deps.now();
      if (latest && at - latest.at < FRESH_MS) return latest.stats;
      const stats = collect();
      latest = { at, stats };
      // 失败的结果不留着，下一次重新读
      stats.catch(() => {
        if (latest?.stats === stats) latest = undefined;
      });
      return stats;
    },
  };
}

let shared: SystemStatsReader | undefined;

/** 全站共用一个读取器：CPU 的上一次采样和一秒内的结果都存在这里 */
export function readSystemStats(): Promise<SystemStats> {
  shared ??= createSystemStats();
  return shared.read();
}
