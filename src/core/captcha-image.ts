/**
 * 验证码图片（纯逻辑）：几个数字画成抖动过的折线，再叠几道干扰曲线和噪点，输出一整段 SVG。
 * 不用 <text>：字形全是 path，脚本读不到 SVG 里的字；所有笔画合成一条 path、顺序打乱，也分不出哪几笔是一个字
 */

/** 每个数字的笔画，画在 10 × 16 的格子里，x 向右、y 向下 */
const GLYPHS: Readonly<Record<string, readonly (readonly [number, number])[][]>> = {
  '0': [[[5, 0], [9, 3], [10, 8], [9, 13], [5, 16], [1, 13], [0, 8], [1, 3], [5, 0]]],
  '1': [[[2, 4], [6, 0], [6, 16]], [[3, 16], [9, 16]]],
  '2': [[[1, 3], [4, 0], [8, 0], [10, 3], [9, 7], [0, 16], [10, 16]]],
  '3': [[[1, 1], [5, 0], [9, 2], [9, 6], [5, 8], [9, 10], [10, 13], [7, 16], [3, 16], [0, 14]]],
  '4': [[[7, 16], [7, 0], [0, 11], [10, 11]]],
  '5': [[[9, 0], [2, 0], [1, 7], [5, 6], [9, 8], [10, 12], [7, 16], [3, 16], [0, 14]]],
  '6': [[[8, 1], [4, 0], [1, 4], [0, 10], [2, 15], [5, 16], [9, 14], [10, 11], [8, 8], [5, 7], [1, 9]]],
  '7': [[[0, 0], [10, 0], [4, 16]]],
  '8': [[[5, 8], [1, 6], [1, 2], [5, 0], [9, 2], [9, 6], [5, 8], [0, 11], [1, 15], [5, 16], [9, 15], [10, 11], [5, 8]]],
  '9': [[[9, 7], [5, 9], [1, 7], [0, 4], [2, 1], [5, 0], [9, 2], [10, 7], [9, 12], [6, 16], [2, 15]]],
};

export const CAPTCHA_WIDTH = 140;
export const CAPTCHA_HEIGHT = 48;

/** 只画数字；别的字符说明调用方传错了 */
export function canDraw(code: string): boolean {
  return [...code].every((char) => char in GLYPHS);
}

const fixed = (value: number) => value.toFixed(1);

/** random 返回 [0, 1)；测试时注入固定序列 */
export function captchaSvg(code: string, random: () => number = Math.random): string {
  if (!canDraw(code)) throw new Error('验证码只能是数字');
  const between = (min: number, max: number) => min + random() * (max - min);
  const strokes: string[] = [];
  const pitch = (CAPTCHA_WIDTH - 20) / code.length;

  [...code].forEach((char, index) => {
    const scale = between(2, 2.5);
    const angle = (between(-18, 18) * Math.PI) / 180;
    const centerX = 10 + pitch * (index + 0.5) + between(-3, 3);
    const centerY = CAPTCHA_HEIGHT / 2 + between(-3, 3);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const line of GLYPHS[char]!) {
      const points = line.map(([x, y]) => {
        // 以字形中心为原点抖动、缩放、旋转，再挪到这个字的位置
        const dx = (x - 5 + between(-0.45, 0.45)) * scale;
        const dy = (y - 8 + between(-0.45, 0.45)) * scale;
        return `${fixed(centerX + dx * cos - dy * sin)} ${fixed(centerY + dx * sin + dy * cos)}`;
      });
      strokes.push(`M${points.join('L')}`);
    }
  });

  // 洗牌：path 里笔画的先后和字的先后无关
  for (let index = strokes.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [strokes[index], strokes[other]] = [strokes[other]!, strokes[index]!];
  }

  const curves = Array.from({ length: 3 }, () => {
    const y = () => fixed(between(6, CAPTCHA_HEIGHT - 6));
    return `M0 ${y()}Q${fixed(between(30, 110))} ${fixed(between(-10, CAPTCHA_HEIGHT + 10))} ${CAPTCHA_WIDTH} ${y()}`;
  }).join('');
  const dots = Array.from(
    { length: 24 },
    () => `<circle cx="${fixed(between(0, CAPTCHA_WIDTH))}" cy="${fixed(between(0, CAPTCHA_HEIGHT))}" r="${fixed(between(0.6, 1.4))}"/>`,
  ).join('');

  // 放在 <img> 里，读不到页面的 CSS 变量：底色、墨色写死，深色主题下也是一张浅色的小纸片
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CAPTCHA_WIDTH}" height="${CAPTCHA_HEIGHT}" viewBox="0 0 ${CAPTCHA_WIDTH} ${CAPTCHA_HEIGHT}">`,
    `<rect width="100%" height="100%" fill="#f7f3ea"/>`,
    `<g fill="#6b6459">${dots}</g>`,
    `<path d="${curves}" fill="none" stroke="#8a8174" stroke-width="1.4"/>`,
    `<path d="${strokes.join('')}" fill="none" stroke="#2b2722" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    `</svg>`,
  ].join('');
}
