import { formatClock } from './format';

/**
 * 浏览器端刷新所有 [data-clock]。只改变化了的文字，不重建 DOM；
 * 定时对齐到下一秒 / 下一分钟，标签页切回前台时立即校正（后台标签页的定时器会被节流）。
 */

function render(clock: HTMLElement, now: Date): void {
  const { timezone = 'Asia/Shanghai', lang = 'zh-CN' } = clock.dataset;
  const { hours, minutes, seconds, date, weekday } = formatClock(now, timezone, lang);
  // 农历只在服务端算（农历库不进浏览器），跨天后由整页的日期检查刷新页面
  const values: Readonly<Record<string, string>> = { hours, minutes, seconds, date, weekday };
  for (const el of clock.querySelectorAll<HTMLElement>('[data-part]')) {
    const next = values[el.dataset.part ?? ''];
    if (next !== undefined && el.textContent !== next) el.textContent = next;
  }
  clock.querySelector('time')?.setAttribute('datetime', now.toISOString());
}

const clocks = [...document.querySelectorAll<HTMLElement>('[data-clock]')];
const step = clocks.some((clock) => clock.dataset.seconds !== undefined) ? 1000 : 60_000;
let timer: ReturnType<typeof setTimeout> | undefined;

function tick(): void {
  const now = new Date();
  for (const clock of clocks) render(clock, now);
  clearTimeout(timer);
  timer = setTimeout(tick, step - (now.getTime() % step) + 20);
}

if (clocks.length > 0) {
  tick();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
}
