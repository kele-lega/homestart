import type { Registry } from './layout';
import type { AnyWidgetDefinition } from './widget';

/**
 * Widget 注册表：自动发现 src/widgets/<type>/widget.ts。
 * 新增 Widget 只需新建目录，不需要改这里。
 */

function isWidgetDefinition(value: unknown): value is AnyWidgetDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AnyWidgetDefinition>;
  return typeof candidate.type === 'string' && typeof candidate.options?.safeParse === 'function';
}

/** modules 为 import.meta.glob 的结果：路径 → 模块 */
export function buildRegistry(modules: Readonly<Record<string, unknown>>): Registry {
  const entries = Object.entries(modules).map(([path, mod]) => {
    const folder = path.split('/').at(-2) ?? path;
    const definition = (mod as { default?: unknown }).default;
    if (!isWidgetDefinition(definition)) {
      throw new Error(`${path} 必须默认导出 defineWidget(...) 的结果`);
    }
    if (definition.type !== folder) {
      throw new Error(`${path} 的 type 为 "${definition.type}"，必须与目录名 "${folder}" 一致`);
    }
    return [folder, definition] as const;
  });
  return new Map(entries);
}

export const registry: Registry = buildRegistry(import.meta.glob('../widgets/*/widget.ts', { eager: true }));
