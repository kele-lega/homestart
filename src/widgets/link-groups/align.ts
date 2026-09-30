/**
 * 宽屏下分类面板从卡片的哪一侧展开。按卡片实际所在的位置判断，而不是看它是第几个：
 * 分类多于一行放得下的列数时会折行，排在后面的卡片可能落在最左列。
 * 页面是从左到右排版，这里的 start / end 对应左 / 右。
 */

export interface Span {
  readonly left: number;
  readonly right: number;
}

export type Align = 'start' | 'end';

export function alignPanel(card: Span, bounds: Span, panelWidth: number): Align {
  // 左对齐时越过右边界的量、右对齐时越过左边界的量；能放下就左对齐，都放不下选溢出少的一侧
  const spillStart = card.left + panelWidth - bounds.right;
  const spillEnd = bounds.left - (card.right - panelWidth);
  return spillStart <= 0 || spillStart <= spillEnd ? 'start' : 'end';
}
