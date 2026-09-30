/**
 * 分类导航的展开状态，纯函数：从不修改传入的状态；有变化时返回新对象，没有变化时原样返回同一个对象。
 *   popover（桌面）：同一时间只开一组；悬停预览，点击固定（pinned），固定后悬停不再切换
 *   accordion（手机）：各组独立展开收起，点开一组不会让另一组收起，避免内容在手指下跳动
 */
export interface MenuState {
  readonly open: readonly string[];
  readonly pinned: boolean;
}

export const CLOSED: MenuState = Object.freeze({ open: Object.freeze([]), pinned: false });

export function preview(state: MenuState, id: string): MenuState {
  if (state.pinned || (state.open.length === 1 && state.open[0] === id)) return state;
  return { open: [id], pinned: false };
}

export function unpreview(state: MenuState): MenuState {
  return state.pinned ? state : CLOSED;
}

export function pin(state: MenuState, id: string): MenuState {
  return state.pinned && state.open.includes(id) ? CLOSED : { open: [id], pinned: true };
}

/**
 * 焦点进入预览中的面板时把它固定住，免得鼠标移开后面板收起、焦点落进看不见的内容里。
 * 只认焦点进入的那一组：别的分类（没有展开）里的焦点事件不能改动正在预览的这一组
 */
export function hold(state: MenuState, id: string): MenuState {
  return state.pinned || !state.open.includes(id) ? state : { ...state, pinned: true };
}

/**
 * 跨过宽窄断点（窗口缩放、浏览器缩放）时两种模式互换。焦点所在的那一组原本展开就保持展开，
 * 否则它的面板会被隐藏、焦点掉回 <body>；其余全部收起。宽屏下保持展开即固定
 */
export function relayout(state: MenuState, focusedId: string | undefined, wide: boolean): MenuState {
  if (focusedId === undefined || !state.open.includes(focusedId)) return CLOSED;
  return { open: [focusedId], pinned: wide };
}

export function toggle(state: MenuState, id: string): MenuState {
  const open = state.open.includes(id) ? state.open.filter((other) => other !== id) : [...state.open, id];
  return { open, pinned: false };
}
