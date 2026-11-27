import { SolarDay } from 'tyme4ts';

/**
 * 公历日期 → 农历、节气、节日与法定节假日（数据来自 tyme4ts），供月历格子和日程标注使用。
 * 纯函数，只按年月日计算，与时区无关。
 */

export interface CnHoliday {
  /** 法定节假日名称，与国务院通知一致，例如“国庆节”“国庆中秋” */
  readonly name: string;
  /** true：调休上班；false：放假 */
  readonly work: boolean;
}

/** label 取自哪一项，界面据此决定颜色 */
export type CnLabelKind = 'festival' | 'term' | 'month' | 'day';

export interface CnDayInfo {
  /** 农历月名：正月…十月、冬月、腊月，闰月带“闰”，例如“八月”“闰六月” */
  readonly lunarMonth: string;
  /** 农历日名：初一…三十 */
  readonly lunarDay: string;
  /** 农历日的数字 1…30，首页按它画月相 */
  readonly lunarDayNumber: number;
  /** 节气，只在交节当天有值 */
  readonly term: string | undefined;
  /** 节日的显示名（见 FESTIVAL_NAMES）；农历、公历节日同一天时取农历 */
  readonly festival: string | undefined;
  readonly holiday: CnHoliday | undefined;
  /** 格子里的一行小字：节日 > 节气 > 初一显示月名 > 农历日 */
  readonly label: string;
  readonly labelKind: CnLabelKind;
  /** 有节日或节气，需要醒目显示 */
  readonly marked: boolean;
}

/**
 * 节日显示名：格子只放得下两三个字。传统节日和国庆去掉“节”字，
 * 春节、除夕、元旦、小年保持原样，其余不超过三个字的保持原样。
 * tyme4ts 的名称本来就不含“三八”“五一”之类的前缀，只有下表中的几项需要改
 */
export const FESTIVAL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  国庆节: '国庆',
  元宵节: '元宵',
  龙头节: '龙抬头',
  上巳节: '上巳',
  清明节: '清明',
  端午节: '端午',
  七夕节: '七夕',
  中元节: '中元',
  中秋节: '中秋',
  重阳节: '重阳',
  冬至节: '冬至',
  腊八节: '腊八',
});

// 与旧版主页一致：十一月、十二月叫冬月、腊月
const MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];

function displayFestival(name: string | undefined): string | undefined {
  return name === undefined ? undefined : (FESTIVAL_NAMES[name] ?? name);
}

/** month 为 1~12；超出 tyme4ts 支持的年份（1~9999）时抛 Error */
export function cnDayInfo(year: number, month: number, day: number): CnDayInfo {
  const solar = SolarDay.fromYmd(year, month, day);
  const lunar = solar.getLunarDay();
  const lunarMonthOf = lunar.getLunarMonth();
  const lunarMonth = `${lunarMonthOf.isLeap() ? '闰' : ''}${MONTH_NAMES[lunarMonthOf.getMonth() - 1]}`;
  const lunarDay = lunar.getName();

  const termDay = solar.getTermDay();
  const term = termDay.getDayIndex() === 0 ? termDay.getName() : undefined;
  const festival = displayFestival(lunar.getFestival()?.getName() ?? solar.getFestival()?.getName());
  const legal = solar.getLegalHoliday();
  const holiday = legal ? { name: legal.getName(), work: legal.isWork() } : undefined;

  const [label, labelKind]: readonly [string, CnLabelKind] = festival
    ? [festival, 'festival']
    : term
      ? [term, 'term']
      : lunar.getDay() === 1
        ? [lunarMonth, 'month']
        : [lunarDay, 'day'];

  return {
    lunarMonth,
    lunarDay,
    lunarDayNumber: lunar.getDay(),
    term,
    festival,
    holiday,
    label,
    labelKind,
    marked: festival !== undefined || term !== undefined,
  };
}

/**
 * 当前所在的节气和它已经过了几天（节气当天为 0），例如「立冬」后第 3 天。
 * 和 cnDayInfo 一样只在服务端用
 */
export function currentTerm(year: number, month: number, day: number): { readonly name: string; readonly days: number } {
  const termDay = SolarDay.fromYmd(year, month, day).getTermDay();
  return { name: termDay.getName(), days: termDay.getDayIndex() };
}

/** 干支：年、月按立春和每月的「节」交替，日按六十甲子轮转，例如 丙午年 己亥月 甲辰日 */
export interface CnGanzhi {
  readonly year: string;
  readonly month: string;
  readonly day: string;
}

export function cnGanzhi(year: number, month: number, day: number): CnGanzhi {
  const cycle = SolarDay.fromYmd(year, month, day).getSixtyCycleDay();
  return { year: cycle.getYear().getName(), month: cycle.getMonth().getName(), day: cycle.getSixtyCycle().getName() };
}

export type CnSeason = 'spring' | 'summer' | 'autumn' | 'winter';

// 从立春起算，每季六个节气
const TERMS_FROM_SPRING = [
  '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑',
  '立秋', '处暑', '白露', '秋分', '寒露', '霜降',
  '立冬', '小雪', '大雪', '冬至', '小寒', '大寒',
] as const;
const SEASONS: readonly CnSeason[] = ['spring', 'summer', 'autumn', 'winter'];

/** 节气所在的季节：立春到谷雨是春，立夏到大暑是夏……认不出的名字算冬 */
export function seasonOfTerm(term: string): CnSeason {
  const index = TERMS_FROM_SPRING.indexOf(term as (typeof TERMS_FROM_SPRING)[number]);
  return index < 0 ? 'winter' : SEASONS[Math.floor(index / 6)]!;
}

/** 二十四节气，从立春开始 */
export const SOLAR_TERMS: readonly string[] = TERMS_FROM_SPRING;
