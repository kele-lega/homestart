import { describe, expect, it } from 'vitest';
import { alignPanel } from '../../../src/widgets/link-groups/align';

// 导航条占据 0~800px，面板宽 272px（17rem）
const NAV = { left: 0, right: 800 };
const PANEL = 272;
const card = (left: number, width = 150) => ({ left, right: left + width });

describe('alignPanel', () => {
  it('opens from the left edge of the card while the panel fits inside the nav', () => {
    expect(alignPanel(card(0), NAV, PANEL)).toBe('start');
    expect(alignPanel(card(400), NAV, PANEL)).toBe('start');
  });

  it('flips to the right edge when a start-aligned panel would run past the nav', () => {
    expect(alignPanel(card(650), NAV, PANEL)).toBe('end');
  });

  it('decides by position, not by order, so a card wrapped to the start of a new row stays start-aligned', () => {
    // 窄一点的桌面宽度下，第 5 个分类折到第二行第一列：按下标会判成 end，按几何应为 start
    expect(alignPanel(card(0, 175), { left: 0, right: 760 }, PANEL)).toBe('start');
  });

  it('treats an exact fit as fitting', () => {
    expect(alignPanel(card(528), NAV, PANEL)).toBe('start');
  });

  it('picks the side that spills less when neither side fits', () => {
    const nav = { left: 0, right: 300 };
    expect(alignPanel(card(60, 150), nav, 320)).toBe('start');
    expect(alignPanel(card(140, 150), nav, 320)).toBe('end');
  });
});
