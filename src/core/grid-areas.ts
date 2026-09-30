/**
 * CSS Grid 模板校验。layout.yaml 里的 areas / columns 会写进内联 CSS 变量，
 * 这里既防止写错导致布局悄悄错位，也防止任意字符注入样式。
 */

const AREA_NAME = /^[a-z][a-z0-9-]*$/;
const NULL_CELL = /^\.+$/;
const TRACK_LIST = /^[a-z0-9().,%\s-]+$/i;

interface Bounds {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly cells: number;
}

export interface AreasResult {
  /** 按首次出现顺序排列的区域名 */
  readonly names: readonly string[];
  readonly problems: readonly string[];
}

export function parseAreas(rows: readonly string[]): AreasResult {
  if (rows.length === 0) return { names: [], problems: ['areas 不能为空'] };

  const grid = rows.map((row) => row.trim().split(/\s+/));
  const problems: string[] = [];
  if (grid.some((row) => row.length !== grid[0]!.length)) {
    problems.push(`areas 每行的列数必须相同：${rows.map((r) => `"${r}"`).join(' ')}`);
  }

  const bounds = new Map<string, Bounds>();
  grid.forEach((row, y) =>
    row.forEach((name, x) => {
      if (NULL_CELL.test(name)) return;
      if (!AREA_NAME.test(name)) {
        problems.push(`区域名 ${name} 只能包含小写字母、数字和连字符`);
        return;
      }
      const prev = bounds.get(name);
      bounds.set(
        name,
        prev
          ? {
              top: Math.min(prev.top, y),
              bottom: Math.max(prev.bottom, y),
              left: Math.min(prev.left, x),
              right: Math.max(prev.right, x),
              cells: prev.cells + 1,
            }
          : { top: y, bottom: y, left: x, right: x, cells: 1 },
      );
    }),
  );

  // 格子数等于外接矩形面积 ⇔ 区域是完整矩形
  for (const [name, b] of bounds) {
    if ((b.bottom - b.top + 1) * (b.right - b.left + 1) !== b.cells) {
      problems.push(`区域 "${name}" 必须是矩形`);
    }
  }
  return { names: [...bounds.keys()], problems };
}

/** grid-template-columns 取值白名单：只允许长度、fr、minmax()/repeat() 这类字符 */
export function isSafeTrackList(value: string): boolean {
  return TRACK_LIST.test(value) && value.trim().length > 0;
}
