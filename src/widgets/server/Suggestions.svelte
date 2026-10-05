<!--
  管理员看建议：一张浮起来的纸（PaperDialog），打开时取一次最新的列表。
  每一条能标成已处理（再点一次改回来）或删除（先确认）；已处理的淡一些，排在原来的位置不动。
  列表变了就把还没处理的条数报给外面，按钮上的数字跟着变
-->
<script lang="ts">
  import { tick } from 'svelte';
  import PaperDialog from '../../components/PaperDialog.svelte';
  import { formatWhen } from '../../lib/account-view';
  import { fetchSuggestions, markSuggestion, pendingCount, removeSuggestion, type Suggestion } from '../../lib/suggestions';

  interface Props {
    timeZone: string;
    /** 还没处理的条数 */
    onpending: (count: number) => void;
  }

  let { timeZone, onpending }: Props = $props();

  let sheet = $state<PaperDialog>();
  let list = $state<readonly Suggestion[] | undefined>(undefined);
  let busy = $state(false);
  let confirming = $state<string | undefined>(undefined);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);

  export async function open(): Promise<void> {
    if (!sheet?.open()) return;
    notice = undefined;
    confirming = undefined;
    const result = await fetchSuggestions();
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      return;
    }
    update(result.list);
  }

  function update(next: readonly Suggestion[]): void {
    list = next;
    onpending(pendingCount(next));
  }

  async function onMark(item: Suggestion): Promise<void> {
    busy = true;
    notice = undefined;
    const result = await markSuggestion(item.id, !item.done);
    busy = false;
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      return;
    }
    update(result.list);
  }

  async function onRemove(item: Suggestion): Promise<void> {
    busy = true;
    notice = undefined;
    const result = await removeSuggestion(item.id);
    busy = false;
    confirming = undefined;
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      return;
    }
    update(result.list);
    notice = { kind: 'ok', text: '已删除一条建议' };
    // 被删的那一条连同它的按钮都不在了，焦点落回纸上
    await tick();
    sheet?.focusPaper();
  }

  const whenOf = (item: Suggestion) => formatWhen(item.createdAt, timeZone);
</script>

<PaperDialog bind:this={sheet} title="建议" labelId="suggestions-title" onclose={() => (confirming = undefined)}>
  {#if notice}
    <p class="notice" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
  {/if}

  {#if list === undefined}
    {#if !notice}<p class="empty">正在读取…</p>{/if}
  {:else if list.length === 0}
    <p class="empty">还没有人提过建议。</p>
  {:else}
    <ol class="list" role="list">
      {#each list as item (item.id)}
        <li class="item" data-done={item.done ? '' : undefined}>
          <p class="meta">
            <time datetime={new Date(item.createdAt).toISOString()}>{whenOf(item)}</time>
            <span aria-hidden="true">·</span>
            <span>{item.author}{item.author === item.username ? '' : `（${item.username}）`}</span>
            {#if item.done}<span class="tag">已处理</span>{/if}
          </p>
          <p class="body">{item.body}</p>
          <div class="item-actions">
            {#if confirming === item.id}
              <span class="confirm-text">删掉这一条？</span>
              <button type="button" class="text-btn" data-kind="danger" disabled={busy} onclick={() => onRemove(item)}>确认删除</button>
              <button type="button" class="text-btn" disabled={busy} onclick={() => (confirming = undefined)}>取消</button>
            {:else}
              <button type="button" class="text-btn" disabled={busy} onclick={() => onMark(item)}>
                {item.done ? '改回未处理' : '标为已处理'}
              </button>
              <button type="button" class="text-btn" data-kind="danger" disabled={busy} onclick={() => (confirming = item.id)}>删除</button>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</PaperDialog>

<style>
  /* 列表、按钮的样子在 PaperDialog；这里只有「已处理」的淡色和小标签 */
  .item[data-done] .body {
    color: var(--ink-3);
  }

  .tag {
    padding: 0 0.375rem;
    font: var(--text-2xs) / 1.6 var(--label);
    letter-spacing: 0.08em;
    color: var(--blue);
    border: 1px solid currentcolor;
  }
</style>
