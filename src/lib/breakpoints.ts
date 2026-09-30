/**
 * 桌面 / 手机布局的分界。CSS 的 @media 里不能用变量，各样式表只能写字面量 48rem，
 * tests/styles/breakpoints.test.ts 检查它们都与这里一致，岛屿里 matchMedia 用的是同一个值。
 */
export const WIDE_MIN = '48rem';
export const WIDE_QUERY = `(width > ${WIDE_MIN})`;
