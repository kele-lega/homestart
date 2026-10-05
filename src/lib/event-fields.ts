/**
 * 自己添加的日程（不是订阅里的）的表单字段：浏览器的编辑框和服务端的校验共用。
 * 日期、钟点都是站点时区的墙上时间，和表单里填的一模一样；全天日程的结束日期含当天（表单里看到的就是这样）。
 * 浏览器端也用，不能引用服务端代码
 */
import { addDays, diffDays, isDateKey } from './zoned-time';

export interface EventFields {
  readonly title: string;
  readonly location: string;
  readonly allDay: boolean;
  /** 'YYYY-MM-DD' */
  readonly startDate: string;
  /** 'HH:mm'；全天日程忽略 */
  readonly startTime: string;
  /** 'YYYY-MM-DD'，含 */
  readonly endDate: string;
  readonly endTime: string;
}

export const EVENT_LIMITS = { title: 200, location: 200, maxDays: 366, perUser: 1000 } as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_KEY = '1900-01-01';
const MAX_KEY = '2200-12-31';

export const isTimeText = (value: string): boolean => TIME.test(value);

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const validDate = (key: string): boolean => isDateKey(key) && key >= MIN_KEY && key <= MAX_KEY;

/** 不合格时返回给用户看的中文说明 */
export function fieldsProblem(fields: EventFields): string | undefined {
  if (!fields.title.trim()) return '请填写标题';
  if (Array.from(fields.title.trim()).length > EVENT_LIMITS.title) return `标题最多 ${EVENT_LIMITS.title} 个字`;
  if (Array.from(fields.location.trim()).length > EVENT_LIMITS.location) return `地点最多 ${EVENT_LIMITS.location} 个字`;
  if (!validDate(fields.startDate) || !validDate(fields.endDate)) return '日期无效，只支持 1900 至 2200 年';
  if (!fields.allDay && (!isTimeText(fields.startTime) || !isTimeText(fields.endTime))) return '时间格式为 HH:mm';
  const days = diffDays(fields.startDate, fields.endDate);
  if (days < 0) return '结束日期不能早于开始日期';
  if (days >= EVENT_LIMITS.maxDays) return `一件日程最长 ${EVENT_LIMITS.maxDays} 天`;
  if (!fields.allDay && days === 0 && fields.endTime < fields.startTime) return '结束时间不能早于开始时间';
  return undefined;
}

/** 去掉标题、地点首尾的空白 */
export function tidyFields(fields: EventFields): EventFields {
  return { ...fields, title: fields.title.trim(), location: fields.location.trim() };
}

/** 从开始到结束的分钟数；全天日程按整天算 */
function durationMinutes(fields: EventFields): number {
  const days = Math.max(0, diffDays(fields.startDate, fields.endDate));
  if (fields.allDay) return days * 1440;
  return Math.max(0, days * 1440 + minutesOf(fields.endTime) - minutesOf(fields.startTime));
}

/**
 * 改了开始的日期或钟点：结束跟着挪，时长不变（和 Google 日历一样）。
 * 开始的值本身不合格（正在输入）时原样返回
 */
export function moveStart(fields: EventFields, start: { readonly date: string; readonly time: string }): EventFields {
  const next = { ...fields, startDate: start.date, startTime: start.time };
  if (!isDateKey(start.date) || (!fields.allDay && !isTimeText(start.time))) return next;
  if (!isDateKey(fields.startDate) || !isDateKey(fields.endDate)) return next;
  const total = (fields.allDay ? 0 : minutesOf(start.time)) + durationMinutes(fields);
  return {
    ...next,
    endDate: addDays(start.date, Math.floor(total / 1440)),
    endTime: fields.allDay ? fields.endTime : timeOf(total % 1440),
  };
}

/**
 * 新建时的默认值：在今天新建从下一个整点开始，其他日子从 9 点开始，都是一小时。
 * nowTime 是站点时区此刻的 'HH:mm'；23 点以后的下一个整点跨到明天，就从今天 23:00 开始
 */
export function draftFields(date: string, today: string, nowTime: string): EventFields {
  const hour = date === today ? Math.min(23, Number(nowTime.slice(0, 2)) + 1) : 9;
  const start = timeOf(hour * 60);
  const end = hour === 23 ? '23:59' : timeOf((hour + 1) * 60);
  return { title: '', location: '', allDay: false, startDate: date, startTime: start, endDate: date, endTime: end };
}
