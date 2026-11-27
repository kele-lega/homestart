/**
 * 题诗轮换：钟点下面的两行诗，按墙上的钟算该写第几联（服务端和浏览器算法一样，刷新页面不会跳回第一联），
 * 每 LIAN_PERIOD 换一次，淡出、换字、淡入。诗的列表由 InkPage 写在 .lian 的 data-lian 上
 */
export const LIAN_PERIOD = 30_000;
const FADE = 800;

export function lianIndex(length: number, nowMs: number): number {
  return length > 0 ? Math.floor(nowMs / LIAN_PERIOD) % length : 0;
}

type Line = readonly [first: string, second: string, source: string];

export function initLian(): void {
  const box = document.querySelector<HTMLElement>('.lian[data-lian]');
  // 上句在上，下句在下
  const [upper, lower] = box ? [...box.querySelectorAll<HTMLElement>(':scope > span')] : [];
  if (!box || !upper || !lower) return;
  let pool: Line[];
  try {
    pool = JSON.parse(box.dataset.lian ?? '[]') as Line[];
  } catch {
    return;
  }
  if (pool.length < 2) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let shown = pool.findIndex(([first]) => first === upper.textContent?.trim());

  const put = (index: number) => {
    const [first, second, source] = pool[index]!;
    upper.textContent = first;
    lower.textContent = second;
    box.title = source;
    shown = index;
  };

  const tick = () => {
    const next = lianIndex(pool.length, Date.now());
    if (next !== shown) {
      if (reduced.matches || document.hidden) put(next);
      else {
        box.toggleAttribute('data-swap', true);
        setTimeout(() => {
          put(next);
          box.removeAttribute('data-swap');
        }, FADE);
      }
    }
    setTimeout(tick, LIAN_PERIOD - (Date.now() % LIAN_PERIOD) + 50);
  };
  tick();
}
