<!--
  一排「器物格」，一格是一卷：点开是一幅挂轴（PaperDialog kind="juan"，样子见 ink/scroll.css），这一卷的几张卡片都在轴里。
  设置页、个人中心都这样摆：页面上只有几格，东西再多也只是轴里长一点。
  地址带 #卡片 id（/account#sessions）或 #卷名 时，打开页面就展开那一卷、滚到那张卡片；收起时把 # 去掉，刷新不会又展开。
  格子上的器物（icon）和轴里的卡片（content）由用的地方按卷名画
-->
<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import PaperDialog from './PaperDialog.svelte';

  interface Juan {
    readonly id: string;
    /** 格子和轴上的名字 */
    readonly name: string;
    /** 这一卷里的卡片：[卡片的 id, 名字]；名字连起来是格子上的一行小字（除非给了 sum） */
    readonly cards: readonly (readonly [id: string, label: string])[];
    /** 格子上的小字，不给就是卡片名连起来 */
    readonly sum?: string;
  }

  interface Props {
    juans: readonly Juan[];
    /** 格子上的器物线描：画在 0 0 40 40 的 svg 里，.faint 是淡线、.dan 是朱砂 */
    icon: Snippet<[id: string]>;
    content: Snippet<[id: string]>;
  }

  let { juans, icon, content }: Props = $props();

  const dialogs = $state<Record<string, PaperDialog | undefined>>({});

  /** 打开一卷；给了卡片 id 就滚到那张 */
  async function unroll(juan: string, card?: string): Promise<void> {
    const dialog = dialogs[juan];
    if (!dialog) return;
    dialog.open();
    history.replaceState(history.state, '', `#${card ?? juan}`);
    if (!card) return;
    await tick();
    document.getElementById(card)?.scrollIntoView({ block: 'start' });
  }

  function fromHash(): void {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const juan = juans.find((j) => j.id === id || j.cards.some(([card]) => card === id));
    if (!juan || dialogs[juan.id]?.isOpen()) return;
    // 别的卷开着时先收起来，一次只挂一幅
    for (const [key, dialog] of Object.entries(dialogs)) if (key !== juan.id) dialog?.close();
    void unroll(juan.id, juan.id === id ? undefined : id);
  }

  // 收起来就把地址上的 #… 去掉；收起的动画还没播完就点开了另一卷时不动
  function rolledUp(): void {
    if (Object.values(dialogs).some((dialog) => dialog?.isOpen())) return;
    if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
  }

  onMount(() => {
    fromHash();
    addEventListener('hashchange', fromHash);
    return () => removeEventListener('hashchange', fromHash);
  });
</script>

<ul class="shelf">
  {#each juans as juan (juan.id)}
    <li>
      <button type="button" class="qi-tile" aria-haspopup="dialog" onclick={() => unroll(juan.id)}>
        <svg class="qi-icon" viewBox="0 0 40 40" aria-hidden="true">{@render icon(juan.id)}</svg>
        <span class="qi-name">{juan.name}</span>
        <span class="qi-sum">{juan.sum ?? juan.cards.map(([, label]) => label).join(' · ')}</span>
      </button>
    </li>
  {/each}
</ul>

{#each juans as juan (juan.id)}
  <PaperDialog bind:this={dialogs[juan.id]} title={juan.name} labelId="juan-{juan.id}" kind="juan" onclose={rolledUp}>
    <div class="juan">{@render content(juan.id)}</div>
  </PaperDialog>
{/each}

<style>
  /* 宽屏四格一排，窄了两格，再窄一格 */
  .shelf {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(10.5rem, 100%), 1fr));
    gap: 1.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .qi-tile {
    display: grid;
    grid-template-rows: auto auto 1fr;
    justify-items: center;
    gap: 0.5rem;
    inline-size: 100%;
    block-size: 100%;
    padding: 1.8rem 1rem 1.5rem;
    color: var(--ink);
    text-align: center;
    background:
      url('/ink/paper-grain.webp') 0 0 / 256px,
      var(--surface);
    border: 1px solid var(--rule);
    border-radius: 2px;
    transition:
      border-color 0.25s,
      translate 0.25s,
      box-shadow 0.25s;
  }

  .qi-icon {
    inline-size: 3.4rem;
    block-size: 3.4rem;
    margin-block-end: 0.4rem;
    overflow: visible;
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: translate 0.35s cubic-bezier(0.3, 0.7, 0.2, 1);
  }

  .qi-icon :global(.faint) {
    stroke: var(--ink-3);
    stroke-width: 0.9;
  }

  .qi-icon :global(.dan) {
    fill: var(--cinnabar);
    stroke: none;
  }

  .qi-name {
    margin-inline-end: -0.5em;
    font: 400 1.4rem / 1.3 var(--brush);
    letter-spacing: 0.5em;
  }

  .qi-sum {
    font: 0.78rem / 1.6 var(--song);
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }

  .qi-tile:focus-visible {
    outline: 1px solid var(--cinnabar);
    outline-offset: 3px;
  }

  @media (hover: hover) {
    .qi-tile:hover {
      border-color: var(--ink-4);
      box-shadow: 0 14px 26px -20px rgb(48 36 24 / 0.5);
      translate: 0 -2px;
    }

    .qi-tile:hover .qi-icon {
      translate: 0 -3px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .qi-tile,
    .qi-icon {
      transition: none;
    }
  }
</style>
