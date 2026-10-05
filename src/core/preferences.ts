import type { AppConfig } from './config';
import type { Registry, ResolvedWidget } from './layout';

/**
 * 个人偏好：{ Widget 类型: 偏好 }，每种由那个 Widget 的 preferences.schema 校验。
 * 这里只有纯逻辑（校验、合并进配置）；存在哪里、按谁读，见 adapters/preferences
 */
export type Preferences = Readonly<Record<string, unknown>>;

/** 改动：值是 null 的类型恢复默认 */
export type PreferencesPatch = Readonly<Record<string, unknown>>;

/** 只留下已注册、有偏好、并且能通过校验的条目；读不懂的条目读作没设置 */
export function parsePreferences(raw: unknown, registry: Registry): Preferences {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const entries = Object.entries(raw).flatMap(([type, value]) => {
    const parsed = registry.get(type)?.preferences?.schema.safeParse(value);
    return parsed?.success ? [[type, parsed.data] as const] : [];
  });
  return Object.fromEntries(entries);
}

export type PatchResult =
  | { readonly ok: true; readonly next: Preferences }
  | { readonly ok: false; readonly message: string };

/** 把改动合并进已有的偏好。未知的类型、不合格的值整体拒绝，什么都不改 */
export function applyPatch(current: Preferences, patch: PreferencesPatch, registry: Registry): PatchResult {
  const next: Record<string, unknown> = { ...current };
  for (const [type, value] of Object.entries(patch)) {
    const schema = registry.get(type)?.preferences?.schema;
    if (!schema) return { ok: false, message: `没有可以设置的「${type}」` };
    if (value === null) {
      delete next[type];
      continue;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? '设置的内容不合法' };
    next[type] = parsed.data;
  }
  return { ok: true, next };
}

function personalizeWidget(widget: ResolvedWidget, preferences: Preferences, registry: Registry): ResolvedWidget {
  if (widget.error || !Object.hasOwn(preferences, widget.type)) return widget;
  const definition = registry.get(widget.type);
  if (!definition?.preferences) return widget;
  const merged = definition.options.safeParse(definition.preferences.apply(widget.options, preferences[widget.type]));
  return merged.success ? { ...widget, options: merged.data } : widget;
}

/** 偏好合并进各 Widget 的 options 后的配置；没有偏好时原样返回同一个对象 */
export function personalize(config: AppConfig, preferences: Preferences, registry: Registry): AppConfig {
  if (Object.keys(preferences).length === 0) return config;
  const widget = (item: ResolvedWidget) => personalizeWidget(item, preferences, registry);
  const zones = config.layout.zones.map((zone) => ({
    ...zone,
    items: zone.items.map((item) => (item.kind === 'card' ? { ...item, widgets: item.widgets.map(widget) } : widget(item))),
  }));
  return { ...config, layout: { ...config.layout, zones } };
}
