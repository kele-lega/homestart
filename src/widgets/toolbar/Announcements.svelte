<!--
  公告：页头右边的喇叭圆，点开是一张浮起来的纸（PaperDialog），后面整页虚化。
  管理员在里面多一个「写一条」，发布、删除都直接改服务端的列表；首页「本站」版块的「发布公告」派发 COMPOSE_EVENT，直接打开到写一条。
  铃铛上的小红点：有比这个浏览器上次打开时更新的公告（localStorage），打开就算看过
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import PaperDialog from '../../components/PaperDialog.svelte';
  import { formatWhen } from '../../lib/account-view';
  import {
    ANNOUNCEMENT_LIMITS,
    COMPOSE_EVENT,
    fetchAnnouncements,
    hasUnread,
    latestAt,
    publishAnnouncement,
    removeAnnouncement,
    SEEN_STORAGE_KEY,
    type Announcement,
  } from '../../lib/announcements';
  import { MEGAPHONE } from '../../lib/icons';

  interface Props {
    announcements: readonly Announcement[];
    /** 站内登录的管理员：能发布、删除 */
    admin: boolean;
    timeZone: string;
  }

  let { announcements, admin, timeZone }: Props = $props();

  let list = $state(untrack(() => announcements));
  let sheet = $state<PaperDialog>();
  let writeButton = $state<HTMLButtonElement>();
  let titleInput = $state<HTMLInputElement>();
  let seenAt = $state<number | undefined>(undefined);
  let writing = $state(false);
  let draft = $state({ title: '', body: '' });
  let busy = $state(false);
  let confirming = $state<string | undefined>(undefined);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);

  // 服务端不知道这个浏览器看过哪些，红点等注水以后再算，首屏不亮
  const unread = $derived(seenAt !== undefined && hasUnread(list, seenAt));

  onMount(() => {
    seenAt = readSeen();
    if (!admin) return;
    const compose = () => void open(true);
    addEventListener(COMPOSE_EVENT, compose);
    return () => removeEventListener(COMPOSE_EVENT, compose);
  });

  function readSeen(): number {
    try {
      return Number(localStorage.getItem(SEEN_STORAGE_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function markSeen(): void {
    seenAt = Math.max(seenAt ?? 0, latestAt(list));
    try {
      localStorage.setItem(SEEN_STORAGE_KEY, String(seenAt));
    } catch {
      // 存储不可用：小红点下次还会亮，不影响看公告
    }
  }

  /** compose：打开后直接进「写一条」；已经开着时也切过去 */
  async function open(compose = false): Promise<void> {
    if (!sheet) return;
    const opened = sheet.open();
    if (compose) await toggleWriting(true);
    if (!opened) return;
    if (!compose) {
      notice = undefined;
      confirming = undefined;
    }
    markSeen();
    // 页面可能开了很久，或者是从往返缓存里恢复的：打开时取一次最新的，取不到就用手上的
    const result = await fetchAnnouncements();
    if (result.ok) {
      list = result.list;
      if (sheet.isOpen()) markSeen();
    }
  }

  function onClosed(): void {
    writing = false;
    confirming = undefined;
    notice = undefined;
  }

  async function toggleWriting(next: boolean): Promise<void> {
    writing = next;
    notice = undefined;
    await tick();
    (next ? titleInput : writeButton)?.focus();
  }

  async function onPublish(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    notice = undefined;
    const result = await publishAnnouncement(draft.title, draft.body);
    busy = false;
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      titleInput?.focus();
      return;
    }
    list = result.list;
    markSeen();
    // 草稿只在发布成功后清空：写到一半关掉弹窗，下次打开还在
    draft = { title: '', body: '' };
    await toggleWriting(false);
    notice = { kind: 'ok', text: '已发布' };
  }

  async function onRemove(item: Announcement): Promise<void> {
    busy = true;
    notice = undefined;
    const result = await removeAnnouncement(item.id);
    busy = false;
    confirming = undefined;
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      return;
    }
    list = result.list;
    notice = { kind: 'ok', text: `已删除「${item.title}」` };
    // 被删的那一条连同它的按钮都不在了，焦点落回纸上
    await tick();
    sheet?.focusPaper();
  }

  const dateOf = (item: Announcement) => formatWhen(item.createdAt, timeZone).slice(0, 10);
</script>

<!-- 关上时浏览器把焦点还给打开它的这个按钮 -->
<button
  type="button"
  class="circle"
  aria-haspopup="dialog"
  aria-label={unread ? '公告（有新的）' : '公告'}
  onclick={() => open()}
>
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    {#each MEGAPHONE as d (d)}<path {d} />{/each}
  </svg>
  {#if unread}<span class="dot" aria-hidden="true"></span>{/if}
</button>

<PaperDialog bind:this={sheet} title="公告" labelId="announce-title" onclose={onClosed}>
  {#snippet actions()}
    {#if admin && !writing}
      <button bind:this={writeButton} type="button" class="text-btn" onclick={() => toggleWriting(true)}>写一条</button>
    {/if}
  {/snippet}

  {#if notice}
    <p class="notice" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
  {/if}

  {#if admin && writing}
    <form class="compose" onsubmit={onPublish}>
      <label class="field">
        <span class="field-label">标题</span>
        <input
          bind:this={titleInput}
          bind:value={draft.title}
          class="input"
          name="title"
          required
          maxlength={ANNOUNCEMENT_LIMITS.title}
          autocomplete="off"
        />
      </label>
      <label class="field">
        <span class="field-label">正文（可以留空，换行照原样显示）</span>
        <textarea bind:value={draft.body} class="input" name="body" rows="5" maxlength={ANNOUNCEMENT_LIMITS.body}></textarea>
      </label>
      <div class="actions">
        <button type="submit" class="btn" data-kind="primary" disabled={busy}>{busy ? '正在发布…' : '发布'}</button>
        <button type="button" class="btn" disabled={busy} onclick={() => toggleWriting(false)}>取消</button>
      </div>
    </form>
  {/if}

  {#if list.length === 0}
    <p class="empty">还没有公告。</p>
  {:else}
    <ol class="list" role="list">
      {#each list as item (item.id)}
        <li class="item">
          <p class="meta">
            <time datetime={new Date(item.createdAt).toISOString()}>{dateOf(item)}</time>
            <span aria-hidden="true">·</span>
            <span>{item.author}</span>
          </p>
          <h3 class="item-title">{item.title}</h3>
          {#if item.body}<p class="body">{item.body}</p>{/if}
          {#if admin}
            <div class="item-actions">
              {#if confirming === item.id}
                <span class="confirm-text">删掉这一条？</span>
                <button type="button" class="text-btn" data-kind="danger" disabled={busy} onclick={() => onRemove(item)}>
                  确认删除
                </button>
                <button type="button" class="text-btn" disabled={busy} onclick={() => (confirming = undefined)}>取消</button>
              {:else}
                <button type="button" class="text-btn" data-kind="danger" disabled={busy} onclick={() => (confirming = item.id)}>
                  删除
                </button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</PaperDialog>

<style>
  /* 圆按钮的样子在 View.astro（.toolbar .circle），弹窗的样子在 PaperDialog；这里只有右上角的小红点 */
  .dot {
    position: absolute;
    inset-block-start: 0.125rem;
    inset-inline-end: 0.125rem;
    inline-size: 0.5rem;
    block-size: 0.5rem;
    background: var(--red);
    border: 1.5px solid var(--paper);
    border-radius: 50%;
    animation: dot-in var(--dur-open) var(--spring) both;
  }

  @keyframes dot-in {
    from {
      scale: 0;
    }
  }
</style>
