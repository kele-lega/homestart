import { resolve } from 'node:path';
import { z } from 'astro/zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigLoader } from '../../src/core/config';
import { ConfigError } from '../../src/core/config-error';
import { UpstreamError } from '../../src/core/http';
import type { Registry } from '../../src/core/layout';
import { defineWidget, type AnyWidgetDefinition, type WidgetContext } from '../../src/core/widget';
import { loadWidgetData, type WidgetDataDeps } from '../../src/core/widget-data';
import placeholder from '../../src/widgets/placeholder/widget';

const load = vi.fn(async (options: { city: string }, _ctx: WidgetContext) => ({ temperature: 28, city: options.city }));
const probe = defineWidget({ type: 'probe', options: z.strictObject({ city: z.string() }), load });
const silent = defineWidget({ type: 'silent', options: z.strictObject({}) });
const registry: Registry = new Map<string, AnyWidgetDefinition>([
  ['probe', probe],
  ['silent', silent],
  ['placeholder', placeholder],
]);

const loadConfig = createConfigLoader(resolve('tests/fixtures/data-config'), registry);
const logError = vi.fn();
const deps = (overrides: Partial<WidgetDataDeps> = {}): WidgetDataDeps => ({
  loadConfig,
  user: 'alice',
  signal: new AbortController().signal,
  logError,
  ...overrides,
});

beforeEach(() => {
  load.mockClear();
  logError.mockClear();
});

describe('loadWidgetData', () => {
  it("runs the instance's load with its validated options and the request's user", async () => {
    await expect(loadWidgetData(probe, 'probe', deps())).resolves.toEqual({
      ok: true,
      data: { temperature: 28, city: '坪山' },
    });
    expect(load).toHaveBeenCalledWith({ city: '坪山' }, expect.objectContaining({ user: 'alice' }));
  });

  it('fails quietly when the instance is gone, has another type or invalid options', async () => {
    // 页面渲染之后配置可能改过；无效配置已由页面在 Widget 的位置显示
    for (const id of ['nope', 'note', 'broken']) {
      await expect(loadWidgetData(probe, id, deps())).resolves.toEqual({ ok: false });
    }
    expect(load).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('does not log config errors again, the page already reported them', async () => {
    const broken = vi.fn(async () => {
      throw new ConfigError('layout.yaml', ['widgets: 不能为空']);
    });
    await expect(loadWidgetData(probe, 'probe', deps({ loadConfig: broken }))).resolves.toEqual({ ok: false });
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs a failed load with the instance id instead of throwing', async () => {
    load.mockRejectedValueOnce(new UpstreamError('api.open-meteo.com 返回 HTTP 503', 503));
    await expect(loadWidgetData(probe, 'probe', deps())).resolves.toEqual({ ok: false });
    expect(logError).toHaveBeenCalledWith('probe 加载失败：api.open-meteo.com 返回 HTTP 503');
  });

  it('does not log a load that failed because the visitor already left the page', async () => {
    const controller = new AbortController();
    controller.abort();
    load.mockRejectedValueOnce(controller.signal.reason);

    await expect(loadWidgetData(probe, 'probe', deps({ signal: controller.signal }))).resolves.toEqual({ ok: false });
    expect(logError).not.toHaveBeenCalled();
  });

  it('treats a widget without load as a bug: logs it and fails', async () => {
    await expect(loadWidgetData(silent, 'silent', deps())).resolves.toEqual({ ok: false });
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/^silent 加载失败：/));
  });
});
