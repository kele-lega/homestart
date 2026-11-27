import { describe, expect, it } from 'vitest';
import { cnBig, cnMonth, cnNumber, cnYear, greeting, groupDigits, shichen, shichenKe } from '../../src/ink/text';

describe('ink text', () => {
  it('writes 0–99 in Chinese and leaves larger numbers alone', () => {
    expect([0, 7, 10, 14, 20, 24, 99].map(cnNumber)).toEqual(['〇', '七', '十', '十四', '二十', '二十四', '九十九']);
    expect(cnNumber(100)).toBe('100');
    expect(cnNumber(-1)).toBe('-1');
  });

  it('writes years digit by digit and months by name', () => {
    expect(cnYear(2026)).toBe('二〇二六');
    expect(cnMonth(1)).toBe('一月');
    expect(cnMonth(11)).toBe('十一月');
  });

  it('maps hours to the twelve shichen, 23:00 starting 子时', () => {
    expect(shichen(23)).toBe('子时');
    expect(shichen(0)).toBe('子时');
    expect(shichen(1)).toBe('丑时');
    expect(shichen(12)).toBe('午时');
    expect(shichen(22)).toBe('亥时');
  });

  it('splits each shichen into 初 and 正 hours of four 刻', () => {
    expect(shichenKe(11, 0)).toBe('午初初刻');
    expect(shichenKe(12, 6)).toBe('午正初刻');
    expect(shichenKe(12, 59)).toBe('午正三刻');
    expect(shichenKe(23, 30)).toBe('子初二刻');
    expect(shichenKe(0, 15)).toBe('子正一刻');
  });

  it('greets by hour', () => {
    expect([3, 7, 10, 13, 15, 20, 23].map(greeting)).toEqual(['夜深了', '早上好', '上午好', '中午好', '下午好', '晚上好', '夜深了']);
  });

  it('groups digits with thin spaces', () => {
    expect(groupDigits(12345)).toBe('12\u2009345');
    expect(groupDigits(999)).toBe('999');
    expect(groupDigits(-3)).toBe('0');
  });

  it('writes counts as big Chinese numerals with 万 and the right 零', () => {
    expect(cnBig(0)).toBe('〇');
    expect(cnBig(10)).toBe('十');
    expect(cnBig(12)).toBe('十二');
    expect(cnBig(305)).toBe('三百零五');
    expect(cnBig(1005)).toBe('一千零五');
    expect(cnBig(1010)).toBe('一千零一十');
    expect(cnBig(12345)).toBe('一万二千三百四十五');
    expect(cnBig(10005)).toBe('一万零五');
    expect(cnBig(100000)).toBe('十万');
    expect(cnBig(120000)).toBe('十二万');
    expect(cnBig(1e8)).toBe('100\u2009000\u2009000');
  });
});
