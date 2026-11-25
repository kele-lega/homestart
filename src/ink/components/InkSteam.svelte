<script lang="ts">
  /**
   * 游艺：最近两周玩过的游戏。第一款挂成一幅画（横版头图，碰到才上色），其余列在旁边。
   * 数据和旧版 Steam.svelte 同一个 recent 操作；第一次翻到这一页才去取，没看的人不请求 Steam
   */
  import { onMount } from 'svelte';
  import { fetchAction } from '../../lib/widget-api';
  import { readSteamView } from '../../widgets/steam/client';
  import type { SteamView } from '../../widgets/steam/data';

  interface Props {
    id: string;
    count: number;
  }

  let { id, count }: Props = $props();

  let view = $state<SteamView | undefined>(undefined);
  let loadFailed = $state(false);
  let started = false;
  let controller: AbortController | undefined;

  async function load(): Promise<void> {
    started = true;
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

  function onRoute(event: Event): void {
    if (!started && (event as CustomEvent<string>).detail === 'play') void load();
  }

  onMount(() => {
    if (document.documentElement.dataset.route === 'play') void load();
    addEventListener('ink:route', onRoute);
    return () => {
      removeEventListener('ink:route', onRoute);
      controller?.abort();
    };
  });

  const feed = $derived(view?.feed);
  const rows = $derived(feed?.status === 'ok' ? feed.rows.slice(0, Math.max(1, count)) : []);
  const first = $derived(rows[0]);
  const playing = $derived(view?.sub.startsWith('正在玩') ?? false);

  function onCoverError(event: Event): void {
    (event.currentTarget as HTMLImageElement).style.visibility = 'hidden';
  }
</script>

{#if !view}
  {#if loadFailed}
    <p class="feed-notice" data-kind="error">游戏记录没有取到 <button type="button" class="inline" onclick={() => void load()}>重试</button></p>
  {:else}
    <p class="none">正在读取……</p>
  {/if}
{:else if feed?.status === 'nokey'}
  <p class="none">服务器还没有配置 Steam API Key（环境变量 STEAM_API_KEY）。</p>
{:else if feed?.status === 'unbound'}
  <p class="none">绑定 Steam 账号后，这里挂着你最近两周玩过的游戏。<a class="inline" href="/settings#steam">去绑定</a></p>
{:else if feed?.status === 'hidden'}
  <p class="none">拿不到游玩记录：请在 Steam 隐私设置里把「游戏详情」设为公开。</p>
{:else if feed?.status === 'error'}
  <p class="feed-notice" data-kind="error">{feed.message} <button type="button" class="inline" onclick={() => void load()}>重试</button></p>
{:else if !first}
  <p class="none">最近两周没有玩游戏。</p>
{:else}
  <div class="playp">
    <div class="hang">
      <a href={`https://store.steampowered.com/app/${first.appId}/`} target="_blank" rel="noopener noreferrer">
        <img src={first.coverFallback} alt={first.name} width="460" height="215" decoding="async" referrerpolicy="no-referrer" onerror={onCoverError} />
      </a>
    </div>
    <div class="gm">
      {#if playing}<span class="seal">正在玩</span>{/if}
      <h2>{first.name}</h2>
      <p class="gm-meta">{first.meta}</p>
      <p class="gm-detail">{first.detail}{view.account?.name ? `　·　Steam ${view.account.name}` : ''}</p>
      {#if feed?.status === 'ok' && feed.stale}
        <p class="feed-notice" data-kind="stale">Steam 暂时连不上，显示的是之前取到的记录</p>
      {/if}
      {#if rows.length > 1}
        <ol class="gm-list" role="list">
          {#each rows.slice(1) as row (row.appId)}
            <li>
              <a href={`https://store.steampowered.com/app/${row.appId}/`} target="_blank" rel="noopener noreferrer">
                <b>{row.name}</b>
                <small>{row.meta}</small>
              </a>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </div>
{/if}
