import { parseLinks } from '../src/core/links';
import { parseSite } from '../src/core/site';
import type { ViewContext } from '../src/core/widget';

/** 渲染测试用的整站上下文：默认值 + 可选覆盖 */
export function viewContext(site: unknown = {}, links: unknown = {}): ViewContext {
  return { site: parseSite(site), links: parseLinks(links) };
}

// 开发模式下 Astro 给模板里的每个元素加上源码位置
const DEV_ANNOTATION = / data-astro-source-(?:file|loc)="[^"]*"/g;

/** 去掉源码位置标注，才能按标签结构比对 */
export const withoutDevAnnotations = (html: string): string => html.replace(DEV_ANNOTATION, '');
