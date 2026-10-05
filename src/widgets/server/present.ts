import type { SystemStats } from '../../adapters/system-stats';

/**
 * 服务器版块：把 CPU、内存、存储的读数整理成三个圆环和悬停时的详细说明（纯函数）。
 * 结果直接交给浏览器，组件里不再换算
 */

/** 圆环的颜色：七成五以下是墨色，往上琥珀色，九成以上红色 */
export type GaugeLevel = 'ok' | 'high' | 'full';

export interface GaugeDetail {
  readonly term: string;
  readonly value: string;
}

export interface Gauge {
  readonly key: 'cpu' | 'memory' | 'disk';
  readonly label: string;
  /** 0–100 的整数，画圆环和写在圆环里的数 */
  readonly percent: number;
  readonly level: GaugeLevel;
  /** 悬停说明的第一行，例如「3.4 GB / 7.6 GB」 */
  readonly summary: string;
  readonly details: readonly GaugeDetail[];
}

export interface ServerView {
  /** 栏目头右边的「已运行 12 天 4 小时」 */
  readonly uptime: string;
  readonly gauges: readonly [Gauge, Gauge, Gauge];
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 1024 进位；不到 100 留一位小数，和 df -h / free -h 读起来差不多 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** 「已运行 12 天 4 小时」「已运行 3 小时 20 分」「已运行 5 分钟」 */
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `已运行 ${days} 天 ${hours} 小时` : `已运行 ${days} 天`;
  if (hours > 0) return rest > 0 ? `已运行 ${hours} 小时 ${rest} 分` : `已运行 ${hours} 小时`;
  return `已运行 ${rest} 分钟`;
}

export function gaugeLevel(percent: number): GaugeLevel {
  if (percent >= 90) return 'full';
  if (percent >= 75) return 'high';
  return 'ok';
}

/** 0–1 的比例 → 0–100 的整数；分母为 0 时算 0 */
function toPercent(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

function gauge(key: Gauge['key'], label: string, percent: number, summary: string, details: readonly GaugeDetail[]): Gauge {
  return { key, label, percent, level: gaugeLevel(percent), summary, details };
}

export function presentStats({ cpu, memory, disk, uptime }: SystemStats): ServerView {
  const cpuDetails: GaugeDetail[] = [
    ...(cpu.model ? [{ term: '型号', value: cpu.model }] : []),
    { term: '负载', value: cpu.load.map((value) => value.toFixed(2)).join(' · ') },
  ];
  const memoryDetails: GaugeDetail[] = [
    { term: '可用', value: formatBytes(memory.available) },
    ...(memory.cache === undefined ? [] : [{ term: '缓存', value: formatBytes(memory.cache) }]),
    ...(memory.swap ? [{ term: '交换', value: `${formatBytes(memory.swap.used)} / ${formatBytes(memory.swap.total)}` }] : []),
  ];
  // 和 df 一样按「已用 / (已用 + 可写)」算：root 保留块不算进可用空间
  const diskPercent = toPercent(disk.used, disk.used + disk.available);
  return {
    uptime: formatUptime(uptime),
    gauges: [
      gauge('cpu', 'CPU', toPercent(cpu.usage, 1), `${cpu.cores} 核`, cpuDetails),
      gauge('memory', '内存', toPercent(memory.used, memory.total), `${formatBytes(memory.used)} / ${formatBytes(memory.total)}`, memoryDetails),
      gauge('disk', '存储', diskPercent, `${formatBytes(disk.used)} / ${formatBytes(disk.total)}`, [
        { term: '剩余', value: formatBytes(disk.available) },
        { term: '挂载点', value: disk.mount },
      ]),
    ],
  };
}
