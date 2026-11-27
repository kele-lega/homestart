import { describe, expect, it } from 'vitest';
import { isNight, moonPath } from '../../src/ink/moon';
import { cnDayInfo } from '../../src/lib/cn-calendar';

/** 从路径里取出：外弧的 sweep（1 亮在右，0 亮在左）、交界椭圆的横半径、交界弧的 sweep */
function parts(path: string): { outer: number; rx: number; inner: number } {
  const match = path.match(/^M0 -50 A50 50 0 0 ([01]) 0 50 A([\d.]+) 50 0 0 ([01]) 0 -50 Z$/);
  if (!match) throw new Error(`unexpected path ${path}`);
  return { outer: Number(match[1]), rx: Number(match[2]), inner: Number(match[3]) };
}

describe('moon', () => {
  it('counts six in the evening to six in the morning as night', () => {
    expect([17, 18, 23, 0, 5, 6, 12].map(isNight)).toEqual([false, true, true, true, true, false, false]);
  });

  it('draws a thin crescent lit on the right at the start of the month', () => {
    // 初三：上弦前的蛾眉月，交界线凸向右边，几乎贴着外弧
    expect(parts(moonPath(3))).toMatchObject({ outer: 1, inner: 0 });
    expect(parts(moonPath(3)).rx).toBeGreaterThan(40);
  });

  it('is nearly full in the middle of the month', () => {
    const { rx } = parts(moonPath(15.76));
    expect(rx).toBeGreaterThan(49.9);
  });

  it('wanes from the right after the full moon (lit on the left)', () => {
    // 十八：亏凸月，亮在左，交界凸向右（暗的一侧）
    expect(parts(moonPath(18))).toMatchObject({ outer: 0, inner: 0 });
    // 廿六：残月，亮在左，交界凸向左（亮的一侧）
    expect(parts(moonPath(26))).toMatchObject({ outer: 0, inner: 1 });
  });

  it('gets the lunar day as a number from the calendar', () => {
    expect(cnDayInfo(2026, 11, 26)).toMatchObject({ lunarDay: '十八', lunarDayNumber: 18 });
    expect(cnDayInfo(2025, 7, 25)).toMatchObject({ lunarDay: '初一', lunarDayNumber: 1 });
  });
});
