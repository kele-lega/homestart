import { describe, expect, it, vi } from 'vitest';
import { cleanModel, createSystemStats, parseMeminfo, type SystemDeps } from '../../src/adapters/system-stats';

const KB = 1024;
const GB = 1024 ** 3;

const MEMINFO = [
  'MemTotal:        8000000 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:    4500000 kB',
  'Buffers:           50000 kB',
  'Cached:          1900000 kB',
  'SReclaimable:     300000 kB',
  'SwapTotal:       1000000 kB',
  'SwapFree:         750000 kB',
  'HugePages_Total:       0',
].join('\n');

/** 每个核心的累计时间；busy 是 user + sys 的毫秒数 */
const core = (busy: number, idle: number) => ({
  model: 'Intel(R) Xeon(R) CPU E5-2682 v4 @ 2.50GHz',
  times: { user: busy, nice: 0, sys: 0, idle, irq: 0 },
});

/** 可控的时钟和 CPU 计数：每次 cpus() 依次返回下一组 */
function fakeDeps(samples: ReturnType<typeof core>[][], overrides: Partial<SystemDeps> = {}) {
  let clock = 100_000;
  let index = 0;
  const deps: Partial<SystemDeps> = {
    cpus: () => samples[Math.min(index++, samples.length - 1)]!,
    loadavg: () => [0.5, 0.25, 0.125],
    uptime: () => 90_061,
    meminfo: async () => MEMINFO,
    statfs: async () => ({ bsize: 4096, blocks: 1000, bfree: 400, bavail: 350 }),
    now: () => clock,
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    ...overrides,
  };
  return { deps, advance: (ms: number) => (clock += ms) };
}

describe('parseMeminfo', () => {
  it('reads kB values as bytes and keeps plain counts as they are', () => {
    const info = parseMeminfo(MEMINFO);

    expect(info.get('MemTotal')).toBe(8_000_000 * KB);
    expect(info.get('HugePages_Total')).toBe(0);
  });
});

describe('cleanModel', () => {
  it('drops trademark marks and the word CPU', () => {
    expect(cleanModel('Intel(R) Xeon(R) CPU E5-2682 v4 @ 2.50GHz')).toBe('Intel Xeon E5-2682 v4 @ 2.50GHz');
    expect(cleanModel('  ')).toBeUndefined();
  });
});

describe('createSystemStats', () => {
  it('samples twice on the first read and reports busy / total', async () => {
    // 两个核心：第二次采样比第一次多了 250ms 忙碌、750ms 空闲 → 25%
    const { deps } = fakeDeps([
      [core(1000, 9000), core(1000, 9000)],
      [core(1125, 9375), core(1125, 9375)],
    ]);
    const stats = await createSystemStats(deps).read();

    expect(deps.sleep).toHaveBeenCalledOnce();
    expect(stats.cpu).toEqual({ model: 'Intel Xeon E5-2682 v4 @ 2.50GHz', cores: 2, usage: 0.25, load: [0.5, 0.25, 0.125] });
    expect(stats.uptime).toBe(90_061);
  });

  it('uses the previous read as the baseline when it is recent', async () => {
    const { deps, advance } = fakeDeps([[core(0, 1000)], [core(100, 1900)], [core(600, 2400)]]);
    const reader = createSystemStats(deps);
    await reader.read();
    advance(5_000);

    const second = await reader.read();

    // 第二次不再等待：直接和上一次的计数做差，(600-100) / (3000-2000) = 50%
    expect(deps.sleep).toHaveBeenCalledOnce();
    expect(second.cpu.usage).toBe(0.5);
  });

  it('shares one result between reads within a second', async () => {
    const { deps, advance } = fakeDeps([[core(0, 1000)], [core(100, 1900)]]);
    const reader = createSystemStats(deps);
    const first = reader.read();
    advance(500);

    expect(reader.read()).toBe(first);
  });

  it('reports memory like free: used is total minus available', async () => {
    const { deps } = fakeDeps([[core(0, 0)]]);
    const { memory } = await createSystemStats(deps).read();

    expect(memory).toEqual({
      total: 8_000_000 * KB,
      used: 3_500_000 * KB,
      available: 4_500_000 * KB,
      cache: 2_250_000 * KB,
      swap: { total: 1_000_000 * KB, used: 250_000 * KB },
    });
  });

  it('falls back to os totals when /proc/meminfo is missing', async () => {
    const { deps } = fakeDeps([[core(0, 0)]], {
      meminfo: async () => {
        throw new Error('ENOENT');
      },
      totalmem: () => 8 * GB,
      freemem: () => 6 * GB,
    });
    const { memory } = await createSystemStats(deps).read();

    expect(memory).toEqual({ total: 8 * GB, used: 2 * GB, available: 6 * GB, cache: undefined, swap: undefined });
  });

  it('reports the disk like df: used counts reserved blocks, available does not', async () => {
    const { deps } = fakeDeps([[core(0, 0)]]);
    const { disk } = await createSystemStats(deps, '/data').read();

    expect(disk).toEqual({ mount: '/data', total: 1000 * 4096, used: 600 * 4096, available: 350 * 4096 });
  });

  it('forgets a failed read so the next one retries', async () => {
    const statfs = vi.fn().mockRejectedValueOnce(new Error('EIO')).mockResolvedValue({ bsize: 1, blocks: 1, bfree: 1, bavail: 1 });
    const { deps } = fakeDeps([[core(0, 0)]], { statfs });
    const reader = createSystemStats(deps);

    await expect(reader.read()).rejects.toThrow('EIO');
    await expect(reader.read()).resolves.toMatchObject({ disk: { total: 1 } });
  });
});
