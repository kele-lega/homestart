import { describe, expect, it } from 'vitest';
import type { SystemStats } from '../../../src/adapters/system-stats';
import { formatBytes, formatUptime, gaugeLevel, presentStats } from '../../../src/widgets/server/present';

const GB = 1024 ** 3;

function stats(overrides: Partial<SystemStats> = {}): SystemStats {
  return {
    cpu: { model: 'Intel Xeon E5-2682 v4 @ 2.50GHz', cores: 8, usage: 0.234, load: [0.5, 0.61, 0.7] },
    memory: { total: 8 * GB, used: 3.44 * GB, available: 4.6 * GB, cache: 2.1 * GB, swap: undefined },
    disk: { mount: '/', total: 100 * GB, used: 52 * GB, available: 43 * GB },
    uptime: 12 * 86_400 + 4 * 3600 + 59,
    ...overrides,
  };
}

describe('formatBytes', () => {
  it('uses binary units with one decimal below 100', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3.4 * GB)).toBe('3.4 GB');
    expect(formatBytes(96.7 * GB)).toBe('96.7 GB');
    expect(formatBytes(250 * GB)).toBe('250 GB');
    expect(formatBytes(2 * 1024 * GB)).toBe('2.0 TB');
  });
});

describe('formatUptime', () => {
  it('keeps the two largest units', () => {
    expect(formatUptime(12 * 86_400 + 4 * 3600 + 59)).toBe('已运行 12 天 4 小时');
    expect(formatUptime(3 * 86_400 + 20 * 60)).toBe('已运行 3 天');
    expect(formatUptime(3 * 3600 + 20 * 60)).toBe('已运行 3 小时 20 分');
    expect(formatUptime(2 * 3600)).toBe('已运行 2 小时');
    expect(formatUptime(59)).toBe('已运行 0 分钟');
  });
});

describe('gaugeLevel', () => {
  it('turns amber at 75% and red at 90%', () => {
    expect(gaugeLevel(74)).toBe('ok');
    expect(gaugeLevel(75)).toBe('high');
    expect(gaugeLevel(90)).toBe('full');
  });
});

describe('presentStats', () => {
  it('draws CPU, memory and storage in that order', () => {
    const view = presentStats(stats());

    expect(view.uptime).toBe('已运行 12 天 4 小时');
    expect(view.gauges.map((g) => [g.label, g.percent, g.level])).toEqual([
      ['CPU', 23, 'ok'],
      ['内存', 43, 'ok'],
      // df 的算法：52 / (52 + 43)
      ['存储', 55, 'ok'],
    ]);
  });

  it('writes the hover details for each gauge', () => {
    const [cpu, memory, disk] = presentStats(stats()).gauges;

    expect(cpu.summary).toBe('8 核');
    expect(cpu.details).toEqual([
      { term: '型号', value: 'Intel Xeon E5-2682 v4 @ 2.50GHz' },
      { term: '负载', value: '0.50 · 0.61 · 0.70' },
    ]);
    expect(memory.summary).toBe('3.4 GB / 8.0 GB');
    expect(memory.details).toEqual([
      { term: '可用', value: '4.6 GB' },
      { term: '缓存', value: '2.1 GB' },
    ]);
    expect(disk.summary).toBe('52.0 GB / 100 GB');
    expect(disk.details).toEqual([
      { term: '剩余', value: '43.0 GB' },
      { term: '挂载点', value: '/' },
    ]);
  });

  it('adds swap only when there is some, and skips a missing CPU model', () => {
    const [cpu, memory] = presentStats(
      stats({
        cpu: { model: undefined, cores: 2, usage: 1, load: [2, 2, 2] },
        memory: { total: 4 * GB, used: 3.8 * GB, available: 0.2 * GB, cache: undefined, swap: { total: 2 * GB, used: 0.5 * GB } },
      }),
    ).gauges;

    expect(cpu.details.map((d) => d.term)).toEqual(['负载']);
    expect(cpu.level).toBe('full');
    expect(memory.details).toEqual([
      { term: '可用', value: '205 MB' },
      { term: '交换', value: '512 MB / 2.0 GB' },
    ]);
  });

  it('reads an empty disk as 0% instead of dividing by zero', () => {
    const view = presentStats(stats({ disk: { mount: '/', total: 0, used: 0, available: 0 } }));

    expect(view.gauges[2].percent).toBe(0);
  });
});
