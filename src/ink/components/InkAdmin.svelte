<script lang="ts">
  /**
   * 跋的右边一栏，只渲染在管理员的页面里（InkPage 按登录角色决定要不要放它），别人的页面里没有这些按钮、
   * 服务入口的网址，也不会下载这段脚本。接口本身另有权限检查（/api/suggestions、/api/server/stats 不是管理员一律 403）。
   * - 管理：查看建议（带未处理条数）、发布公告（打开告示里的「写一条」）、账号管理
   * - 服务器：CPU、内存、存储三根细线，只在正看着这一页、标签页在前台时每 5 秒取一次；下面是 layout.yaml 里配的服务入口
   */
  import { untrack } from 'svelte';
  import { COMPOSE_EVENT } from '../../lib/announcements';
  import { jsonHeaders } from '../../lib/widget-api';
  import { readServerView, STATS_URL } from '../../widgets/server/client';
  import type { ServerView } from '../../widgets/server/present';
  import Suggestions from '../../widgets/server/Suggestions.svelte';
  import type { ServerEntry } from '../../widgets/server/widget';
  import { cnNumber } from '../text';

  interface Props {
    /** 还没处理的建议条数 */
    pending: number;
    entries: readonly ServerEntry[];
    timeZone: string;
  }

  let { pending: initialPending, entries, timeZone }: Props = $props();

  const POLL_MS = 5_000;
  const PLACEHOLDER = ['处理器', '内存', '存储'];

  let pending = $state(untrack(() => initialPending));
  let suggestions = $state<Suggestions>();
  let view = $state<ServerView | undefined>(undefined);
  let failed = $state(false);
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watching = false;
  /** 403：登录过期或不再是管理员，这一页不再轮询 */
  let refused = false;

  async function refresh(): Promise<void> {
    clearTimeout(timer);
    controller?.abort();
    const current = new AbortController();
    controller = current;
    let status = 0;
    try {
      const response = await fetch(STATS_URL, { headers: jsonHeaders('GET'), signal: current.signal });
      status = response.status;
      const data = readServerView(await response.json());
      if (current.signal.aborted) return;
      if (data) view = data;
      failed = data === undefined;
    } catch {
      if (current.signal.aborted) return;
      failed = true;
    }
    refused = status === 403;
    if (!refused && watching) timer = setTimeout(() => void refresh(), POLL_MS);
  }

  function sync(): void {
    const next = document.documentElement.dataset.route === 'site' && document.visibilityState === 'visible';
    if (next === watching) return;
    watching = next;
    if (watching && !refused) void refresh();
    else {
      clearTimeout(timer);
      controller?.abort();
    }
  }

  function onSuggested(): void {
    pending += 1;
  }

  $effect(() => {
    document.addEventListener('visibilitychange', sync);
    addEventListener('ink:route', sync);
    addEventListener('ink:suggested', onSuggested);
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      removeEventListener('ink:route', sync);
      removeEventListener('ink:suggested', onSuggested);
      clearTimeout(timer);
      controller?.abort();
    };
  });

  // 首页底下「跋」入口的小字跟着未处理条数走
  $effect(() => {
    const hint = document.querySelector<HTMLElement>('[data-hint="site"]');
    if (hint) hint.textContent = pending > 0 ? `建议${pending < 100 ? cnNumber(pending) : pending}则` : '本站与建议';
  });

  const gauges = $derived(view?.gauges ?? PLACEHOLDER.map((label) => ({ key: label, label, percent: 0, level: 'ok' as const, summary: '' })));
</script>

<div class="blk adm-blk">
  <h2 class="blk-h">管 理</h2>
  <div class="adm">
    <button type="button" aria-haspopup="dialog" onclick={() => void suggestions?.open()}>
      查看建议{#if pending > 0}<sup>{pending}<span class="visually-hidden"> 条未处理</span></sup>{/if}
    </button>
    <button type="button" aria-haspopup="dialog" onclick={() => dispatchEvent(new Event(COMPOSE_EVENT))}>发布告示</button>
    <a href="/account#users">账号管理</a>
  </div>

  <h2 class="blk-h">服 务 器</h2>
  <div class="srv" aria-busy={!view && !failed}>
    {#each gauges as gauge (gauge.key)}
      <div class="g" data-level={gauge.level} title={gauge.summary}>
        <span>{gauge.label}</span>
        <i style:--w="{gauge.percent}%" aria-hidden="true"></i>
        <em>{view ? `${gauge.percent}%` : '—'}</em>
      </div>
    {/each}
    <p class="m">
      {#if failed}
        暂时连不上服务器状态
      {:else if view}
        {view.uptime}
      {:else}
        正在读取……
      {/if}
      {#if entries.length > 0}
        <br />
        {#each entries as entry (entry.url)}
          <a href={entry.url} target="_blank" rel="noopener noreferrer" title={entry.description}>{entry.name} ↗</a>
        {/each}
      {/if}
    </p>
  </div>
</div>

<Suggestions bind:this={suggestions} {timeZone} onpending={(count) => (pending = count)} />
