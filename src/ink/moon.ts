/**
 * 首页入夜后把朱日换成月亮，按农历日画圆缺。服务端和浏览器都用（router.ts 每分钟判断一次入夜）
 */

/** 傍晚六点到清晨六点算夜里 */
export function isNight(hour: number): boolean {
  return hour >= 18 || hour < 6;
}

const SYNODIC = 29.53;

/**
 * 月亮亮面的路径，圆心在原点、半径 r。农历日换算成月龄比例（初一 0 新月，约十五、十六 0.5 满月）；
 * 亮面 = 外侧半圆 + 明暗交界的半椭圆，椭圆横半径 r·|cos 2π·月龄|。
 * 上弦（前半月）亮在右，下弦（后半月）亮在左；交界线不到一半时凸向亮的一侧，过半时凸向暗的一侧
 */
export function moonPath(lunarDay: number, r = 50): string {
  const age = (((lunarDay - 1) / SYNODIC) % 1 + 1) % 1;
  const rx = Math.abs(Math.cos(age * 2 * Math.PI)) * r;
  const waxing = age < 0.5;
  const outer = waxing ? 1 : 0;
  const inner = (waxing ? age < 0.25 : age < 0.75) ? 0 : 1;
  return `M0 ${-r} A${r} ${r} 0 0 ${outer} 0 ${r} A${round(rx)} ${r} 0 0 ${inner} 0 ${-r} Z`;
}

const round = (n: number) => Math.round(n * 100) / 100;
