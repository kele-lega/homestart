<script lang="ts">
  /**
   * Steam：最近两周玩过的游戏，正在玩的排最前。挂载后经 recent 操作取回，点击不做任何操作。
   * 底部管理自己绑定的 SteamID64（服务端存，浏览器只看得到自己填的这一份）
   */
  import { onMount, tick } from 'svelte';
  import type { WidgetHeading } from '../../core/widget';
  import { fetchAction, sendAction } from '../../lib/widget-api';
  import { readBinding, readSteamView } from './client';
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

  // 绑定设置：SteamID64 只提交、不回显，保存后显示为「账号：xxx」
  const SAVE_FAILED = '保存失败，请稍后再试';
  let editing = $state(false);
  let saving = $state(false);
  let status = $state<{ readonly kind: 'error' | 'info'; readonly text: string; readonly invalid?: boolean } | undefined>(undefined);
  let accountInput = $state<HTMLInputElement | undefined>(undefined);
  let removeButton = $state<HTMLButtonElement | undefined>(undefined);
  let toggleButton = $state<HTMLButtonElement | undefined>(undefined);
  const bound = $derived(view?.account !== undefined);
  const accountLabel = $derived(view?.account ? (view.account.name ?? view.account.steamId) : undefined);

  async function openForm(): Promise<void> {
    editing = true;
    status = undefined;
    await tick();
    accountInput?.focus();
  }

  function closeForm(): void {
    editing = false;
    status = undefined;
    toggleButton?.focus();
  }

  async function submit(action: 'bind' | 'unbind', options: { method: 'PUT' | 'DELETE'; body?: unknown }, done: string): Promise<void> {
    saving = true;
    status = undefined;
    try {
      const result = readBinding(await sendAction(id, action, options));
      if (result.ok) {
        status = { kind: 'info', text: done };
        editing = false;
        await load();
        await tick();
        toggleButton?.focus();
        return;
      }
      status = { kind: 'error', text: result.message, invalid: action === 'bind' };
    } catch {
      status = { kind: 'error', text: SAVE_FAILED };
    }
    saving = false;
    await tick();
    (action === 'bind' ? accountInput : removeButton)?.focus();
  }

  function onSave(event: SubmitEvent): void {
    event.preventDefault();
    void submit('bind', { method: 'PUT', body: { account: accountInput?.value ?? '' } }, '已绑定，正在读取游戏记录…');
  }

  function onRemove(): void {
    void submit('unbind', { method: 'DELETE' }, '已解除绑定');
  }

  function closeOnEscape(form: HTMLFormElement): () => void {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeForm();
    };
    form.addEventListener('keydown', onKey);
    return () => form.removeEventListener('keydown', onKey);
  }

  function retry(): void {
    void load();
  }

  // 封面图取不到（CDN 挡了、appId 没有封面）时藏起 img，露出骨架色的底
  function hideBrokenCover(event: Event): void {
    (event.currentTarget as HTMLElement).style.display = 'none';
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
    <p class="feed-notice">绑定 Steam 账号后，这里显示你最近两周玩过的游戏</p>
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
          <img class="g-cover" src={row.cover} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={hideBrokenCover} />
          <span class="g-name"><span class="g-name-text">{row.name}</span></span>
          <span class="g-meta">
            <span class="g-meta-short" aria-hidden="true">{row.meta}</span>
            <span class="g-meta-long">{row.detail}</span>
          </span>
        </li>
      {/each}
    </ol>
  {/if}

  <div class="st-foot">
    <span class="st-source">
      {#if !view}
        正在读取 Steam…
      {:else if accountLabel}
        账号：{accountLabel}
      {:else}
        还没有绑定 Steam 账号
      {/if}
    </span>
    {#if view}
      <button
        type="button"
        class="st-link"
        aria-expanded={editing}
        bind:this={toggleButton}
        onclick={() => (editing ? closeForm() : openForm())}
      >
        {bound ? '修改绑定' : '绑定账号'}
      </button>
    {/if}
  </div>

  {#if editing}
    <form class="st-form" onsubmit={onSave} {@attach closeOnEscape}>
      <label class="st-field">
        <span class="st-label">SteamID64 或个人资料链接</span>
        <input
          bind:this={accountInput}
          type="text"
          name="account"
          required
          autocomplete="off"
          spellcheck="false"
          placeholder="76561197960265729"
          aria-invalid={status?.invalid === true}
          aria-describedby={status ? `${id}-st-hint ${id}-st-status` : `${id}-st-hint`}
        />
      </label>
      <p class="st-hint" id="{id}-st-hint">
        Steam 客户端 → 账户明细 里的 17 位数字，或粘贴个人资料链接。「游戏详情」要设为公开，否则读不到游玩记录。
      </p>
      <div class="st-actions">
        <button type="submit" class="st-btn primary" disabled={saving}>保存</button>
        {#if bound}
          <button type="button" class="st-btn" disabled={saving} bind:this={removeButton} onclick={onRemove}>解除绑定</button>
        {/if}
        <button type="button" class="st-btn" disabled={saving} onclick={closeForm}>取消</button>
      </div>
    </form>
  {/if}
  <p class="st-status" id="{id}-st-status" role="status" data-kind={status?.kind}>{status?.text ?? ''}</p>
</div>

<style>
  /*
   * 带封面图的节目单：每行一张小封面、游戏名带点状引导线、右边一格叠放简短 / 详细两种说明，
   * 悬停时（有指针的设备）从简短换成详细；没有指针时详细说明常驻，只是视觉上隐藏，读屏仍能读到
   */
  .games {
    padding: 0;
    list-style: none;
  }

  .game {
    display: grid;
    grid-template-columns: 2.5rem minmax(0, 1fr) auto;
    column-gap: 0.5rem;
    align-items: center;
    padding-block: 0.5rem;
  }

  .game + .game {
    border-top: 1px solid var(--rule);
  }

  .g-cover {
    justify-self: start;
    align-self: center;
    inline-size: 2.5rem;
    block-size: 0.9375rem;
    object-fit: cover;
    background: var(--skeleton);
  }

  .g-name {
    display: flex;
    align-items: baseline;
    min-inline-size: 0;
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .g-name-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .g-name::after {
    flex: 1 0 auto;
    min-inline-size: 0.75rem;
    margin-inline: 0.5rem;
    border-bottom: 1.5px dotted var(--ink-3);
    content: '';
  }

  .g-meta {
    position: relative;
    display: grid;
    font: var(--text-xs) / 1 var(--num);
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

  @media not (hover: hover) {
    .g-meta-long {
      position: absolute;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  .bone {
    background: var(--skeleton);
  }

  .game .g-name.bone {
    display: block;
    inline-size: 60%;
    block-size: 0.8125rem;
  }

  .game .g-meta.bone {
    justify-self: end;
    inline-size: 3.5rem;
    block-size: 0.6875rem;
  }

  .st-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.75rem;
    margin-block-start: 0.75rem;
    padding-block-start: 0.625rem;
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-3);
    border-top: var(--rule-thin);
  }

  .games + .st-foot {
    margin-block-start: 0.75rem;
  }

  .st-link {
    padding: 0;
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

  .st-form {
    display: grid;
    gap: 0.5rem;
    margin-block-start: 0.625rem;
  }

  .st-field {
    display: grid;
    gap: 0.25rem;
  }

  .st-label,
  .st-hint {
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--ink-3);
  }

  .st-field input {
    inline-size: 100%;
    padding: 0.25rem 0;
    font: var(--text-lg) / 1.4 var(--num);
    color: var(--ink);
    background: none;
    border: 0;
    border-bottom: 1px solid var(--ink-3);
    border-radius: 0;
  }

  .st-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .st-btn {
    padding: 0.25rem 0.875rem;
    font: var(--text-sm) / 1.5 var(--label);
    border: 1px solid var(--ink-2);
  }

  .st-btn.primary {
    color: var(--paper);
    background: var(--ink);
    border-color: var(--ink);
  }

  .st-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .st-status {
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .st-status[data-kind] {
    margin-block-start: 0.375rem;
  }

  .st-status[data-kind='error'] {
    color: var(--red);
  }
</style>
