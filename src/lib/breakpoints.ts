/**
 * 桌面 / 手机布局的分界。CSS 的 @media 里不能用变量，各样式表只能写字面量 48rem，
 * tests/styles/breakpoints.test.ts 检查它们都与这里一致，岛屿里 matchMedia 用的是同一个值。
 */
export const WIDE_MIN = '48rem';
export const WIDE_QUERY = `(width > ${WIDE_MIN})`;

/**
 * 窄窗口的上限：宽屏里再窄于这个宽度时，区域可以换成 narrowAreas / narrowColumns 的摆法（只在 zones.css 里用）。
 * 页头三栏要让搜索框正好居中，两侧等宽，比这更窄时搜索框挤不下，换成两行
 */
export const NARROW_MAX = '78rem';
