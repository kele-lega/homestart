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

  return { lunarMonth, lunarDay, term, festival, holiday, label, labelKind, marked: festival !== undefined || term !== undefined };
}
