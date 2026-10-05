<script lang="ts">
  /**
   * 翻页计数器：一排 FlipDigit，位数不够时前面补淡色的 0。每一位按「从右数第几位」认，
   * 999 → 1000 时左边多出一张牌，原来的个十百位照常各翻各的。读屏只读整个数。
   *
   * 数字变了不是一下子跳过去，而是一格一格往上数：每一格都等上一次翻完再翻，牌不会翻到一半被打断。
   * 差得少时一格一格慢慢翻（每格 STEP_MAX_MS）；差得多时每格快一点、一次多走几个数，最多 MAX_TICKS 格就到。
   * 快慢在一阵变化开始时（以及又来了新的数时）定一次，之后匀速走完，不会越数越慢
   * 页面看不见时不翻，攒着，切回来稍等一下接着数，看得见翻页。减少动态时直接换成最新的数
   */
  import { untrack } from 'svelte';
  import FlipDigit from './FlipDigit.svelte';

  interface Props {
    value: number;
    /** 至少几位，默认 6 */
    digits?: number;
    label: string;
  }

  let { value, digits = 6, label }: Props = $props();

  /** 一格最多、最少多久；翻页动画占一格的 FLIP_SHARE，留一点空隙再翻下一格 */
  const STEP_MAX_MS = 620;
  const STEP_MIN_MS = 240;
  const FLIP_SHARE = 0.92;
  /** 差得再多，也最多翻这么多格就到 */
  const MAX_TICKS = 12;
  /** 切回页面后先等一下，眼睛落到页面上再翻 */
  const RESUME_MS = 350;
  /**
   * 新的数来了先等这么久再翻：点开网站时新标签页随后才到前台，这一页这时才转到后台。
   * 等一下再看页面还在不在前台，在就翻，不在就攒着，切回来再翻
   */
  const START_MS = 220;

  /** 牌面上正在显示的数；服务端渲染和第一次挂载时就是 value，不翻 */
  let shown = $state(untrack(() => value));
  let flipMs = $state(STEP_MAX_MS * FLIP_SHARE);
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 上一格什么时候开始翻的：新的数来了，也要等它翻完 */
  let lastStep = 0;
  let lastStepMs = 0;
  /** 这一阵还剩几格、每格多久；来了新的数重新定 */
  let ticksLeft = 0;
  let interval = STEP_MAX_MS;

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible = () => document.visibilityState === 'visible';

  function step(): void {
    timer = undefined;
    const gap = value - shown;
    if (gap === 0) {
      ticksLeft = 0;
      return;
    }
    // 往回变（计数文件被手动改小）、减少动态：直接换，不数
    if (gap < 0 || reduced()) {
      shown = value;
      ticksLeft = 0;
      return;
    }
    if (!visible()) return;
    if (ticksLeft <= 0) plan(gap);
    const size = Math.ceil(gap / ticksLeft);
    ticksLeft -= 1;
    flipMs = Math.round(interval * FLIP_SHARE);
    shown += Math.min(size, gap);
    lastStep = performance.now();
    lastStepMs = interval;
    if (shown !== value) timer = setTimeout(step, interval);
  }

  /** 差 gap 个数：分几格走完、每格多久。格数越多每格越快 */
  function plan(gap: number): void {
    ticksLeft = Math.min(gap, MAX_TICKS);
    interval = Math.round(STEP_MAX_MS - ((STEP_MAX_MS - STEP_MIN_MS) * (ticksLeft - 1)) / (MAX_TICKS - 1));
  }

  /** delay：至少再等这么久；上一格还没翻完时等它翻完 */
  function schedule(delay = 0): void {
    if (timer !== undefined) return;
    const wait = Math.max(delay, lastStep + lastStepMs - performance.now(), 0);
    timer = setTimeout(step, wait);
  }

  // 有新的数：已经在数的接着数（每一格重新按剩下的差算快慢），没在数的开始数
  $effect(() => {
    const target = value;
    untrack(() => {
      if (target === shown) return;
      // 正在数的时候又来了新的数：按剩下的差重新定快慢
      if (timer !== undefined || ticksLeft > 0) plan(target - shown);
      schedule(START_MS);
    });
  });

  $effect(() => {
    const onVisibility = () => {
      if (!visible()) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      // 后台攒下的差可能多了不少：按现在的差重新定快慢
      if (value !== shown) {
        plan(value - shown);
        schedule(RESUME_MS);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer);
    };
  });

  const text = $derived(String(Math.max(0, Math.floor(shown))));
  const padded = $derived(text.padStart(digits, '0'));
  const padding = $derived(padded.length - text.length);
  const total = $derived(String(Math.max(0, Math.floor(value))));
</script>

<span class="counter">
  <span class="cards">
    {#each padded as char, index (padded.length - index)}
      <FlipDigit {char} dim={index < padding} duration={flipMs} />
    {/each}
  </span>
  <span class="visually-hidden">{label} {total} 次</span>
</span>

<style>
  .counter {
    display: inline-block;
  }

  .cards {
    display: inline-flex;
    gap: calc(var(--flip-size, 2.25rem) * 0.08);
  }
</style>
