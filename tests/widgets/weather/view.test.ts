import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidgetData } from '../../../src/core/widget-data';
import Live from '../../../src/widgets/weather/Live.astro';

// View.astro 用 server:defer 引用 Live.astro。AstroContainer（astro 7.3.5）构造 manifest 时
// 不带 server island 映射，渲染会报 “Could not find server component name”，所以 View 的
// 地名和骨架由构建后的页面检查和 E2E 测试覆盖，这里只测 island 本身
vi.mock('../../../src/core/widget-data', () => ({ loadWidgetData: vi.fn() }));
vi.mock('../../../src/core/runtime', () => ({ loadConfig: vi.fn() }));

const RAINY = { temperature: 27.6, code: 63, isDay: true, high: 34.8, low: 27, rainChance: 73, humidity: 78 };

let container: AstroContainer;
const renderLive = () =>
  container.renderToString(Live, {
    props: { id: 'weather' },
    request: new Request('http://localhost/', { headers: { 'x-authenticated-user': 'alice' } }),
  });

beforeAll(async () => {
  container = await AstroContainer.create();
});

beforeEach(() => {
  vi.mocked(loadWidgetData).mockReset();
});

describe('weather island', () => {
  it('loads this instance for the signed-in user and renders the forecast', async () => {
    vi.mocked(loadWidgetData).mockResolvedValue({ ok: true, data: RAINY });
    const html = await renderLive();

    const [, id, deps] = vi.mocked(loadWidgetData).mock.calls[0]!;
    expect(id).toBe('weather');
    expect(deps).toMatchObject({ user: 'alice' });
    expect(html).toContain('28°');
    expect(html).toContain('中雨');
    expect(html).toContain('35° / 27°');
    expect(html).toMatch(/最高 35°.*最低 27°/);
    expect(html).toContain('湿度 78% · 降水 73%');
  });

  it('leaves out the humidity and rain line when the forecast has neither', async () => {
    vi.mocked(loadWidgetData).mockResolvedValue({ ok: true, data: { ...RAINY, humidity: undefined, rainChance: undefined } });
    const html = await renderLive();

    expect(html).toContain('28°');
    expect(html).not.toContain('湿度');
    expect(html).not.toContain('降水');
  });

  it('says the weather is unavailable when loading failed', async () => {
    vi.mocked(loadWidgetData).mockResolvedValue({ ok: false });
    const html = await renderLive();

    expect(html).toContain('天气暂时不可用');
    expect(html).not.toContain('°');
  });
});
