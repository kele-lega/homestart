import type { z } from 'astro/zod';
import type { LinksConfig } from './links';
import type { SiteConfig } from './site';

/**
 * Widget 契约。每个 Widget 是 src/widgets/<type>/ 下的独立目录：
 *   widget.ts  —— 默认导出 defineWidget(...)，只含类型、配置 schema 和服务端数据加载，不引用 UI
 *   View.astro —— 展示层，接收 WidgetViewProps
 * 两者都由注册表按目录名自动发现，新增 Widget 不需要修改任何已有文件。
 */

export type Chrome = 'card' | 'bare';

export type WidgetHead = 'frame' | 'view';

/** 交给 View 画的栏目头：标题文字和标题层级（所在区域有标题时降一级） */
export interface WidgetHeading {
  readonly title: string;
  readonly level: 2 | 3;
}

export interface WidgetContext {
  /** 反向代理注入的登录用户，用于按用户隔离数据与缓存 */
  readonly user: string;
  readonly signal: AbortSignal;
  /** 整站设置（时区等），与 View 收到的 site 相同 */
  readonly site: SiteConfig;
}

export type ActionMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** 操作收到的上下文：比 load 多一个校验过的请求体，没有声明 body 的操作为 undefined */
export interface ActionContext<B = undefined> extends WidgetContext {
  readonly body: B;
}

/**
 * 浏览器端可调用的服务端操作，经 /api/widgets/<实例 id>/<操作名> 暴露（如搜索联想、保存日历地址）。
 * query 校验 URL 查询参数；声明了 body 的操作还要求 JSON 请求体并按它校验。返回值包在 { success, data, error } 里。
 */
export interface WidgetAction<O = unknown, Q = unknown, R = unknown, B = undefined> {
  /** 默认 GET；请求方法不符返回 405 */
  readonly method?: ActionMethod;
  readonly query: z.ZodType<Q>;
  /** JSON 请求体的 schema；不声明就不读请求体。浏览器的 GET 不能带请求体，GET 操作不要声明 */
  readonly body?: z.ZodType<B>;
  readonly run: (options: O, query: Q, ctx: ActionContext<B>) => Promise<R>;
  /** 成功结果允许浏览器私有缓存的秒数，默认不缓存；只对 GET 生效 */
  readonly maxAge?: number;
}

/** 原样返回；让 query / body 的类型从 schema 推断出来 */
export function defineAction<O, Q, R, B = undefined>(action: WidgetAction<O, Q, R, B>): WidgetAction<O, Q, R, B> {
  return action;
}

/** 操作的输入不合法（例如订阅地址填错）：消息直接显示给用户，返回 400，不记错误日志 */
export class ActionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionInputError';
  }
}

export interface WidgetDefinition<O = unknown, D = unknown> {
  /** 必须与所在目录名一致 */
  readonly type: string;
  /** 实例未设置 title 时使用的默认标题；bare 类型一般不需要 */
  readonly title?: string;
  /** card：带卡片外框；bare：直接放在区域里（时钟、搜索框等） */
  readonly chrome?: Chrome;
  /**
   * 栏目头由谁画。frame（默认）：外框画标题；view：交给 View，它能在标题旁放随数据变化的补充说明（件数、月份）。
   * 实例配置出错时外框照常画标题，View 不会被渲染
   */
  readonly head?: WidgetHead;
  readonly options: z.ZodType<O>;
  /**
   * 服务端数据加载，由 Widget 自己的 server island 经 loadWidgetData 调用：页面先显示骨架，不等外部接口。
   * 缓存也由 Widget 决定——只有它知道数据按用户隔离还是全站共享。没有动态数据的 Widget 不需要
   */
  readonly load?: (options: O, ctx: WidgetContext) => Promise<D>;
  readonly actions?: Readonly<Record<string, WidgetAction<O, any, unknown, any>>>;
}

export type AnyWidgetDefinition = WidgetDefinition<any, any>;

export function defineWidget<O, D = never>(definition: WidgetDefinition<O, D>): WidgetDefinition<O, D> {
  return definition;
}

/** View.astro 收到的 props。site / links 是整站只读配置，供时钟时区、常用网站、本地搜索等使用 */
export interface WidgetViewProps<O = unknown> {
  readonly id: string;
  readonly options: O;
  readonly site: SiteConfig;
  readonly links: LinksConfig;
  /** 只有 head: 'view' 且设置了标题的 Widget 才有；View 要自己画栏目头 */
  readonly heading?: WidgetHeading;
}

/** 页面 → 区域 → 外框逐层传给 View 的整站上下文 */
export type ViewContext = Pick<WidgetViewProps, 'site' | 'links'>;
