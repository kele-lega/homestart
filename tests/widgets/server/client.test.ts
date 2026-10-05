import { describe, expect, it } from 'vitest';
import { readServerView } from '../../../src/widgets/server/client';

const gauge = (label: string) => ({ key: 'cpu', label, percent: 12, level: 'ok', summary: '8 核', details: [] });

describe('readServerView', () => {
  it('accepts a well-shaped view', () => {
    const body = { success: true, data: { uptime: '已运行 3 天', gauges: [gauge('CPU'), gauge('内存'), gauge('存储')] } };

    expect(readServerView(body)).toEqual(body.data);
  });

  it('rejects a failed or malformed response', () => {
    expect(readServerView({ success: false, error: '只有管理员可以查看服务器状态' })).toBeUndefined();
    expect(readServerView({ success: true, data: { uptime: '已运行 3 天', gauges: [gauge('CPU')] } })).toBeUndefined();
    expect(readServerView({ success: true, data: { uptime: 3, gauges: [gauge('CPU'), gauge('内存'), gauge('存储')] } })).toBeUndefined();
    expect(readServerView(null)).toBeUndefined();
  });
});
