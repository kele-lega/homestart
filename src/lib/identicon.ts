/**
 * 默认头像：GitHub 那样的 5×5 左右对称色块图（identicon）。图案和颜色全由账号的随机种子决定，
 * 种子在开通账号时随机生成、不能自己指定（见 adapters/auth/store）。
 * 这个模块会进浏览器，不能引用服务端代码
 */

/** 种子：32 位十六进制（16 字节随机数） */
export const AVATAR_SEED = /^[0-9a-f]{32}$/;

export interface Identicon {
  /** 5×5 网格里填色的格子，[列, 行]，已经按左右对称展开 */
  readonly cells: readonly (readonly [number, number])[];
  /** hsl(...) 颜色 */
  readonly color: string;
}

export const IDENTICON_GRID = 5;

const nibble = (seed: string, index: number) => Number.parseInt(seed[index % seed.length] ?? '0', 16);

/**
 * 前 15 个十六进制位决定左边三列（含中线）哪些格子填色：偶数填。
 * 后面几位决定颜色：色相 0-359，饱和度和亮度落在中间一段，深浅两种主题下都看得清
 */
export function identicon(seed: string): Identicon {
  const cells: [number, number][] = [];
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < IDENTICON_GRID; row += 1) {
      if (nibble(seed, column * IDENTICON_GRID + row) % 2 !== 0) continue;
      cells.push([column, row]);
      const mirror = IDENTICON_GRID - 1 - column;
      if (mirror !== column) cells.push([mirror, row]);
    }
  }
  const hue = Math.round(((nibble(seed, 25) * 256 + nibble(seed, 26) * 16 + nibble(seed, 27)) / 4095) * 359);
  const saturation = 45 + Math.round((nibble(seed, 28) / 15) * 20);
  const lightness = 50 + Math.round((nibble(seed, 29) / 15) * 12);
  return { cells, color: `hsl(${hue} ${saturation}% ${lightness}%)` };
}
