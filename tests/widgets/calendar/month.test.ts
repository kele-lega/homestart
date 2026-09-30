import { describe, expect, it } from 'vitest';
import { monthGrid } from '../../../src/widgets/calendar/month';

const SEPTEMBER = { year: 2026, month: 9 };
const TODAY = '2026-09-30';

const cellOn = (date: string) => {
  const cell = monthGrid(SEPTEMBER, TODAY).cells.find((candidate) => candidate.date === date);
  if (!cell) throw new Error(`${date} 不在 2026 年 9 月的格子里`);
  return cell;
};

describe('monthGrid', () => {
  it('starts on the Monday before the 1st and fills whole weeks', () => {
    // 2026-09-01 是星期二，9 月 30 日是星期三
    const grid = monthGrid(SEPTEMBER, TODAY);

    expect(grid).toMatchObject({ key: '2026-09', year: 2026, month: 9, range: { from: '2026-08-31', to: '2026-10-05' } });
    expect(grid.cells).toHaveLength(35);
    expect(grid.cells.at(0)).toMatchObject({ date: '2026-08-31', day: 31, outside: true });
    expect(grid.cells.at(1)).toMatchObject({ date: '2026-09-01', day: 1, outside: false });
    expect(grid.cells.at(-1)).toMatchObject({ date: '2026-10-04', outside: true });
  });

  it('uses four to six rows depending on where the month starts', () => {
    // 2027 年 2 月从周一开始、正好 28 天；2026 年 8 月从周六开始、有 31 天
    expect(monthGrid({ year: 2027, month: 2 }, TODAY).cells).toHaveLength(28);
    expect(monthGrid({ year: 2026, month: 8 }, TODAY).cells).toHaveLength(42);
  });

  it('marks only today', () => {
    const cells = monthGrid(SEPTEMBER, TODAY).cells.filter((cell) => cell.today);

    expect(cells.map((cell) => cell.date)).toEqual([TODAY]);
    expect(monthGrid(SEPTEMBER, '2026-10-15').cells.some((cell) => cell.today)).toBe(false);
  });

  it('labels each day with the festival, solar term, lunar month on the 1st, or lunar day', () => {
    expect(cellOn('2026-09-25')).toMatchObject({ label: '中秋', accent: true });
    expect(cellOn('2026-09-23')).toMatchObject({ label: '秋分', accent: true });
    expect(cellOn('2026-09-11')).toMatchObject({ label: '八月', accent: true });
    expect(cellOn('2026-09-10')).toMatchObject({ label: '教师节', accent: true });
    expect(cellOn(TODAY)).toMatchObject({ label: '二十', accent: false });
  });

  it('follows the legal holiday schedule: make-up workdays are not rest days', () => {
    // 2026：中秋 9/25~27 放假，国庆 9/20（周日）调休上班
    expect(cellOn('2026-09-25')).toMatchObject({ rest: true, badge: '休' });
    expect(cellOn('2026-09-20')).toMatchObject({ rest: false, badge: '班' });
    expect(cellOn('2026-09-19')).toMatchObject({ rest: true, badge: undefined });
    expect(cellOn(TODAY)).toMatchObject({ rest: false, badge: undefined });
  });

  it('describes the day in full for screen readers', () => {
    expect(cellOn('2026-09-25').description).toBe('9月25日 星期五，农历八月十五，中秋，中秋节放假');
    expect(cellOn('2026-09-20').description).toBe('9月20日 星期日，农历八月初十，国庆节调休上班');
    expect(cellOn(TODAY).description).toBe('9月30日 星期三，农历八月二十');
  });

  it('gives the padding days from the next month their own data', () => {
    expect(cellOn('2026-10-01')).toMatchObject({
      outside: true,
      label: '国庆',
      rest: true,
      badge: '休',
      description: '10月1日 星期四，农历八月廿一，国庆，国庆节放假',
    });
  });

  it('names Qingming once even though it is both a solar term and a festival', () => {
    const qingming = monthGrid({ year: 2026, month: 4 }, TODAY).cells.find((cell) => cell.date === '2026-04-05');

    expect(qingming?.description).toBe('4月5日 星期日，农历二月十八，清明，清明节放假');
  });

  it('crosses the year boundary', () => {
    const grid = monthGrid({ year: 2026, month: 12 }, TODAY);

    expect(grid.range).toEqual({ from: '2026-11-30', to: '2027-01-04' });
    expect(grid.cells.find((cell) => cell.date === '2027-01-01')).toMatchObject({ outside: true, label: '元旦', accent: true });
  });
});
