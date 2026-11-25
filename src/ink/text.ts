/**
 * 留白用到的中文写法：数目、年份、时辰。服务端和浏览器共用，不能引用服务端模块
 */

const DIGITS = '〇一二三四五六七八九';

/** 0–99 写成中文：7 → 七，10 → 十，24 → 二十四；更大的数照阿拉伯数字写 */
export function cnNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 10) return DIGITS[n]!;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${ones === 0 ? '' : DIGITS[ones]}`;
}

/** 年份逐位写：2026 → 二〇二六 */
export function cnYear(year: number): string {
  return [...String(year)].map((digit) => DIGITS[Number(digit)] ?? digit).join('');
}

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/** 1–12 → 一月…十二月 */
export function cnMonth(month: number): string {
  return `${MONTHS[month - 1] ?? month}月`;
}

const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';

/** 十二时辰：23 点到 1 点是子时，每两个钟头一个 */
export function shichen(hour: number): string {
  const index = Math.floor(((hour + 1) % 24) / 2);
  return `${BRANCHES[index]}时`;
}

/** 按钟点问候 */
export function greeting(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  if (hour < 23) return '晚上好';
  return '夜深了';
}

/** 计数器上的数：千分位用细空格隔开，12 345 */
export function groupDigits(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const UNITS = ['', '十', '百', '千'];

/** 0–9999 */
function belowMyriad(n: number): string {
  const digits = String(n);
  let out = '';
  for (const [index, digit] of [...digits].entries()) {
    const place = digits.length - 1 - index;
    if (digit === '0') {
      if (place > 0 && !out.endsWith('零')) out += '零';
    } else {
      out += DIGITS[Number(digit)]! + UNITS[place]!;
    }
  }
  return out.replace(/零+$/, '');
}

/** 计数写成中文大字：12 → 十二，305 → 三百零五，12 345 → 一万二千三百四十五；一亿以上照阿拉伯数字写 */
export function cnBig(n: number): string {
  const value = Math.max(0, Math.floor(n));
  if (value === 0) return '〇';
  if (value >= 1e8) return groupDigits(value);
  const high = Math.floor(value / 1e4);
  const low = value % 1e4;
  const head = high > 0 ? `${belowMyriad(high)}万` : '';
  const gap = high > 0 && low > 0 && low < 1000 ? '零' : '';
  const text = head + gap + (low > 0 ? belowMyriad(low) : '');
  return text.startsWith('一十') ? text.slice(1) : text;
}
