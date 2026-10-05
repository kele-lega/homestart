import type { WidgetViewProps } from '../core/widget';

/**
 * Widget 展示层：自动发现 src/widgets/<type>/View.astro。
 * 与 core/registry 分开，这样服务端数据逻辑和 API 不会引入任何 UI 代码。
 */

// Astro 组件在类型层面就是接收 props 的函数，返回值由 Astro 渲染器处理
type ViewComponent = (props: WidgetViewProps) => any;

const modules = import.meta.glob<{ default: ViewComponent }>('../widgets/*/View.astro', { eager: true });

export const views: ReadonlyMap<string, ViewComponent> = new Map(
  Object.entries(modules).map(([path, mod]) => [path.split('/').at(-2) ?? path, mod.default]),
);
