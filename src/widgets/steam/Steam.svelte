<script lang="ts">
  /**
   * Steam：最近两周玩过的游戏，正在玩的排最前。挂载后经 recent 操作取回，点击不做任何操作。
   * 绑定哪个 Steam 账号在设置页里改
   */
  import { onMount } from 'svelte';
  import type { WidgetHeading } from '../../core/widget';
  import { fetchAction } from '../../lib/widget-api';
  import { readSteamView } from './client';
  import type { SteamView } from './data';

  interface Props {
    id: string;
    /** 栏目头；实例把标题设成空时没有 */
    heading: WidgetHeading | undefined;
    count: number;
  }

  let { id, heading, count }: Props = $props();

  let view = $state<SteamView | undefined>(undefined);
  let loadFailed = $state(false);
  let controller: AbortController | undefined;

  async function load(): Promise<void> {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loadFailed = false;
    try {
      const data = readSteamView(await fetchAction(id, 'recent', {}, current.signal));
      if (current.signal.aborted) return;
      if (data) view = data;
      else loadFailed = true;
    } catch {
      if (!current.signal.aborted) loadFailed = true;
    }
  }

  onMount(() => {
    void load();
    return () => controller?.abort();
  });

  const sub = $derived(view?.sub ?? '最近游玩');
  const feed = $derived(view?.feed);
  const rows = $derived(feed?.status === 'ok' ? feed.rows : []);

  const skeletonRows = $derived(Math.min(count, 4));

  function retry(): void {
    void load();
  }

  // 竖版封面取不到时换横版头图；再取不到（CDN 挡了）就藏起 img，露出骨架色的底
  function onCoverError(event: Event, fallback: string): void {
    const img = event.currentTarget as HTMLImageElement;
    if (img.dataset.fallback === undefined) {
      img.dataset.fallback = '';
      img.src = fallback;
    } else {
      img.style.display = 'none';
    }
  }
</script>

<div class="steam">
  {#if heading}
    <div class="l-frame-head">
      <svelte:element this={`h${heading.level}`} class="l-frame-title">{heading.title}</svelte:element>
      <span class="l-frame-sub">{sub}</span>
    </div>
  {/if}

  {#if !view}
    {#if loadFailed}
      <p class="feed-notice" data-kind="error">
        游戏记录没有取到
        <button type="button" class="st-link" onclick={retry}>重试</button>
      </p>
    {:else}
      <ol class="games" role="list" aria-hidden="true">
        {#each Array.from({ length: skeletonRows }) as _}
          <li class="game">
            <span class="g-cover bone" aria-hidden="true"></span>
            <span class="g-name bone" aria-hidden="true"></span>
            <span class="g-meta bone" aria-hidden="true"></span>
          </li>
        {/each}
      </ol>
      <span class="visually-hidden">Steam 加载中</span>
    {/if}
  {:else if feed?.status === 'nokey'}
    <p class="feed-notice">服务器还没有配置 Steam API Key（环境变量 STEAM_API_KEY）</p>
  {:else if feed?.status === 'unbound'}
    <p class="feed-notice">
      绑定 Steam 账号后，这里显示你最近两周玩过的游戏
      <a class="feed-link" href="/settings#steam">去绑定</a>
    </p>
  {:else if feed?.status === 'hidden'}
    <p class="feed-notice">拿不到游玩记录：请在 Steam 隐私设置里把「游戏详情」设为公开</p>
  {:else if feed?.status === 'error'}
    <p class="feed-notice" data-kind="error">
      {feed.message}
      <button type="button" class="st-link" onclick={retry}>重试</button>
    </p>
  {:else if rows.length === 0}
    <p class="feed-empty">最近两周没有玩游戏</p>
  {:else}
    {#if feed?.status === 'ok' && feed.stale}
      <p class="feed-notice" data-kind="stale">Steam 暂时连不上，显示的是之前取到的记录</p>
    {/if}
    <ol class="games" role="list">
      {#each rows as row (row.appId)}
        <li class="game">
          <span class="g-cover">
            <img
              src={row.cover}
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              onerror={(event) => onCoverError(event, row.coverFallback)}
            />
          </span>
          <span class="g-name"><span class="g-name-text" title={row.name}>{row.name}</span></span>
          <span class="g-meta">
            <span class="g-meta-short" aria-hidden="true">{row.meta}</span>
            <span class="g-meta-long">{row.detail}</span>
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  /*
   * 带封面图的节目单：每行左边一张竖版封面（2:3），右边上面是游戏名、下面靠右是时长，各压一道细线；
   * 时长一格叠放简短 / 详细两种说明，悬停时（有指针的设备）从简短换成详细；
   * 没有指针时详细说明常驻，只是视觉上隐藏，读屏仍能读到
   */
  .games {
    display: grid;
    gap: 1rem;
    padding: 0;
    list-style: none;
  }

  .game {
    display: grid;
    grid-template-columns: 4rem minmax(0, 1fr);
    grid-template-rows: 1fr 1fr;
    column-gap: 1rem;
  }

  .g-cover {
    grid-row: 1 / -1;
    display: block;
    inline-size: 100%;
    aspect-ratio: 2 / 3;
    overflow: hidden;
    background: var(--skeleton);
  }

  .g-cover img {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .g-name,
  .g-meta {
    align-self: end;
    padding-block-end: 0.375rem;
    border-bottom: 1px solid var(--ink-3);
  }

  .g-name {
    font-size: var(--text-md);
    font-weight: 700;
    line-height: 1.4;
  }

  /* 名字最多两行，再长才省略；截断放在里层，免得裁掉外层的下划线 */
  .g-name-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .g-meta {
    position: relative;
    display: grid;
    justify-self: end;
    min-inline-size: 55%;
    font: var(--text-sm) / 1 var(--num);
    color: var(--ink-2);
    text-align: end;
    white-space: nowrap;
  }

  .g-meta-short,
  .g-meta-long {
    grid-area: 1 / 1;
    transition: opacity var(--dur-hover) var(--ease-out);
  }

  .g-meta-long {
    opacity: 0;
  }

  @media (hover: hover) {
    .game:hover .g-meta-short {
      opacity: 0;
    }

    .game:hover .g-meta-long {
      opacity: 1;
    }
  }

  /*
   * 只剪不缩的话，nowrap 的长句照样从窄格子里伸出去：clip-path 不减滚动范围，
   * 手机页面会被撑宽、能缩小，右边露出空白。收成 1px 再剪，和 base.css 的 .visually-hidden 一样
   */
  @media not (hover: hover) {
    .g-meta-long {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  .bone {
    background: var(--skeleton);
  }

  .game .g-name.bone,
  .game .g-meta.bone {
    margin-block-end: 0.375rem;
    padding: 0;
    border: 0;
  }

  .game .g-name.bone {
    inline-size: 60%;
    block-size: 0.9375rem;
  }

  .game .g-meta.bone {
    inline-size: 5rem;
    min-inline-size: 0;
    block-size: 0.8125rem;
  }

  .st-link {
    padding: 0;
    font: inherit;
    color: var(--blue);
    background: none;
    border: 0;
  }

  .feed-notice .st-link {
    margin-inline-start: 0.375rem;
  }

  @media (hover: hover) {
    .st-link:hover {
      text-decoration: underline;
    }
  }
</style>
