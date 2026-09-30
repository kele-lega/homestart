/**
 * 页面开着过了站点时区的零点，整页刷新一次：日历、今天、Deadline 都按新的一天重新渲染。
 * 判断逻辑见 lib/day-rollover；这里只接上时钟、事件和 sessionStorage
 */
import { claimDeviceReload, dayChanged, rolloverClock } from '../lib/day-rollover';

const CHECK_MS = 60_000;

/** 正在输入的内容不能因为刷新丢掉 */
function typing(): boolean {
  const el = document.activeElement;
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value !== '';
}

/** 文档没有经过网络：来自 HTTP 缓存（历史记录、恢复会话） */
function fromCache(): boolean {
  const [entry] = performance.getEntriesByType?.('navigation') ?? [];
  return entry instanceof PerformanceNavigationTiming && entry.transferSize === 0;
}

function start(shell: HTMLElement): void {
  const { today, timezone, renderedAt } = shell.dataset;
  const rendered = Number(renderedAt);
  if (!today || !timezone || !(rendered > 0)) return;
  const clock = rolloverClock({ renderedAt: rendered, loadedAt: Date.now(), fromCache: fromCache() });

  const check = (): void => {
    if (document.visibilityState !== 'visible' || !dayChanged(today, timezone, clock, Date.now())) return;
    if (typing()) return;
    if (clock.kind === 'device' && !claimDeviceReload(today, () => sessionStorage)) return;
    location.reload();
  };

  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', check);
  // 包括从往返缓存（bfcache）恢复：脚本不会重跑，时钟推算照旧有效
  window.addEventListener('pageshow', check);
}

const shell = document.querySelector<HTMLElement>('[data-today]');
if (shell) start(shell);
