import { z } from 'astro/zod';
import { Id, ToneSchema } from './schema-parts';

export { ToneSchema, type Tone } from './schema-parts';

/** layout.yaml 的结构。跨字段的引用检查在 layout-checks.ts */

const Areas = z.array(z.string()).min(1);
// 纯空白的标题会让折叠按钮失去可读名称
const Title = z.string().trim().min(1, '标题不能为空');
/** 相邻格子之间画细线，画在间隙正中：columns 竖线，rows 横线，both 都画 */
const Dividers = z.enum(['none', 'columns', 'rows', 'both']).default('none');

const WidgetInstance = z.strictObject({
  id: Id,
  type: z.string().min(1),
  title: Title.optional(),
  tone: ToneSchema.optional(),
  options: z.unknown().optional(),
});

const Zone = z.strictObject({
  id: Id,
  title: Title.optional(),
  /** stack：纵向排列；grid：等宽多列（columns 控制列）；areas：按 areas 命名区域摆放 */
  layout: z.enum(['stack', 'grid', 'areas']).default('stack'),
  areas: Areas.optional(),
  columns: z.string().optional(),
  /** flatten：手机上拆开，里面的 Widget 参与整页排序；block：整体保留；collapse：整体保留且可折叠 */
  mobile: z.enum(['flatten', 'block', 'collapse']).default('flatten'),
  mobileAreas: Areas.optional(),
  mobileColumns: z.string().optional(),
  /** 同一行里高度不同的项如何对齐：stretch 等高（默认）；页头这类裸 Widget 通常用 center */
  align: z.enum(['stretch', 'start', 'center', 'end']).default('stretch'),
  dividers: Dividers,
  /** 报头：上方一粗一细两道线、下方一道细线把整个区域夹住，通常只给页头 */
  masthead: z.boolean().default(false),
  /** 字符串为单个 Widget；数组表示桌面端合并为一张卡片（手机端 flatten 时再拆开） */
  items: z.array(z.union([Id, z.array(Id).min(2)])).min(1),
});

export const LayoutSchema = z.strictObject({
  widgets: z.array(WidgetInstance).min(1),
  zones: z.array(Zone).min(1),
  page: z.strictObject({
    desktop: z.strictObject({ areas: Areas, columns: z.string(), rows: z.string().optional(), dividers: Dividers }),
    mobile: z.strictObject({ order: z.array(Id).default([]) }).default({ order: [] }),
  }),
});

export type LayoutConfig = z.infer<typeof LayoutSchema>;
export type ZoneConfig = LayoutConfig['zones'][number];
export type WidgetInstanceConfig = LayoutConfig['widgets'][number];
export type MobileMode = ZoneConfig['mobile'];
export type ZoneLayout = ZoneConfig['layout'];
export type Dividers = ZoneConfig['dividers'];

/** 区域里一项在 areas 中使用的名字：合并卡片取第一个 Widget 的 id */
export function itemAreaName(item: ZoneConfig['items'][number]): string {
  return Array.isArray(item) ? item[0]! : item;
}
