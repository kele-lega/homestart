<script lang="ts">
  /**
   * 首页右下这一格：正面「本站」（计数、提建议、管理员的工具）所有人都看得到；
   * 管理员栏目头右边多一个翻页按钮，翻到背面「服务器」（圆环和服务入口）。
   * 两面都挂着，只是藏起一面：翻回来时圆环还是上次的读数，不会先闪一下空的。
   * 翻页时整块绕竖轴转过去、换一面、再转回来；减少动态时直接换
   */
  import type { WidgetHeading } from '../../core/widget';
  import type { SiteCounts } from '../../lib/site-stats';
  import Machine from './Machine.svelte';
  import SiteFace from './SiteFace.svelte';
  import type { ServerEntry } from './widget';

  interface Props {
    /** 栏目头；实例把标题设成空时没有，翻页按钮也就不在了 */
    heading: WidgetHeading | undefined;
    entries: readonly ServerEntry[];
    admin: boolean;
    signedIn: boolean;
    counts: SiteCounts;
    pending: number;
    timeZone: string;
  }

  let { heading, entries, admin, signedIn, counts, pending, timeZone }: Props = $props();

  const HALF_TURN_MS = 180;

  let face = $state<'site' | 'server'>('site');
  let turning = $state(false);
  let stage = $state<HTMLElement>();
  /** 服务器那一面报上来的「已运行多久」 */
  let uptime = $state<string | undefined>(undefined);

  const onServer = $derived(admin && face === 'server');
  const title = $derived(onServer ? '服务器' : heading?.title);
  const sub = $derived(onServer ? uptime : undefined);

  function swing(element: HTMLElement, from: string, to: string, easing: string): Promise<unknown> {
    return element
      .animate([{ transform: `perspective(60rem) rotateY(${from})` }, { transform: `perspective(60rem) rotateY(${to})` }], {
        duration: HALF_TURN_MS,
        easing,
      })
      .finished.catch(() => undefined);
  }

  async function turn(): Promise<void> {
    if (turning) return;
    const next = face === 'site' ? 'server' : 'site';
    if (!stage || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      face = next;
      return;
    }
    // 往「服务器」翻是往左转，翻回来往右转，像来回翻一张卡片
    const sign = next === 'server' ? '-' : '';
    turning = true;
    await swing(stage, '0deg', `${sign}90deg`, 'cubic-bezier(0.5, 0, 0.75, 0)');
    face = next;
    await swing(stage, `${sign === '-' ? '' : '-'}90deg`, '0deg', 'cubic-bezier(0.25, 1, 0.5, 1)');
    turning = false;
  }
</script>

<div class="panel">
  {#if heading && title}
    <div class="l-frame-head">
      <svelte:element this={`h${heading.level}`} class="l-frame-title">{title}</svelte:element>
      {#if sub}<span class="l-frame-sub">{sub}</span>{/if}
      {#if admin}
        <button
          type="button"
          class="turn"
          aria-label={onServer ? '翻回本站' : '翻到服务器'}
          disabled={turning}
          onclick={turn}
        >
          {#if onServer}
            <span aria-hidden="true">‹</span><span>{heading.title}</span>
          {:else}
            <span>服务器</span><span aria-hidden="true">›</span>
          {/if}
        </button>
      {/if}
    </div>
  {/if}

  <div class="stage" bind:this={stage}>
    <div class="face" hidden={onServer}>
      <SiteFace {counts} {signedIn} {admin} {pending} {timeZone} level={Math.min(6, (heading?.level ?? 2) + 1)} />
    </div>
    {#if admin}
      <div class="face" hidden={!onServer}>
        <Machine {entries} active={onServer} bind:sub={uptime} />
      </div>
    {/if}
  </div>
</div>

<style>
  .panel {
    display: grid;
  }

  /* 有翻页按钮时说明不再靠右，按钮靠右 */
  .panel > :global(.l-frame-head:has(.turn) .l-frame-sub) {
    margin-inline-start: 0;
  }

  .turn {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
    margin-inline-start: auto;
    padding: 0.125rem 0.125rem 0.125rem 0.5rem;
    font: var(--text-sm) / 1.4 var(--label);
    letter-spacing: 0.08em;
    color: var(--blue);
    background: none;
    border: 0;
    -webkit-tap-highlight-color: transparent;
  }

  .turn:disabled {
    cursor: default;
  }

  @media (hover: hover) {
    .turn:not(:disabled):hover {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }

  .stage {
    transform-origin: 50% 50%;
  }

  .face[hidden] {
    display: none;
  }
</style>
