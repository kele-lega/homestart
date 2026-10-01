<!-- 登录设备：每台登录过、还没过期的设备一行，当前这台标「本机」；可以退出某一台，或者一次退出其它全部 -->
<script lang="ts">
  import { tick } from 'svelte';
  import { formatWhen, type SessionView } from '../../lib/account-view';
  import { revokeOtherSessions, revokeSession } from '../../lib/auth-api';

  interface Props {
    sessions: readonly SessionView[];
    timeZone: string;
    /** 退出了设备：列表该刷新了 */
    onchange: () => Promise<void>;
  }

  let { sessions, timeZone, onchange }: Props = $props();

  let busy = $state(false);
  let confirmingAll = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);
  let section = $state<HTMLElement>();
  let othersButton = $state<HTMLButtonElement>();
  const others = $derived(sessions.filter((session) => !session.current).length);

  async function run(action: () => Promise<{ success: boolean; error: string | null }>, done: string): Promise<void> {
    busy = true;
    notice = undefined;
    try {
      const result = await action();
      notice = result.success ? { kind: 'ok', text: done } : { kind: 'error', text: result.error ?? '操作失败，请稍后再试' };
      if (result.success) await onchange();
    } catch {
      notice = { kind: 'error', text: '网络出了点问题，请稍后再试' };
    }
    busy = false;
    confirmingAll = false;
    // 点的那一行可能已经不在了：焦点交给整块卡片，Tab 从这里接着走
    await tick();
    section?.focus();
  }

  const signOutOne = (session: SessionView) => run(() => revokeSession(session.id), `已退出「${session.device}」`);
  const signOutOthers = () => run(revokeOtherSessions, '其它设备都已退出');

  async function askAll(): Promise<void> {
    confirmingAll = true;
    await tick();
    othersButton?.focus();
  }
</script>

<section class="leaf-card" aria-labelledby="sessions-title" tabindex="-1" bind:this={section}>
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="sessions-title">登录设备</h2>
    <span class="leaf-card-hint">勾了「记住我」的 30 天内免登录，其余关掉浏览器就退出</span>
  </div>

  <ul class="sessions" role="list">
    {#each sessions as session (session.id)}
      <li class="session" data-current={session.current ? '' : undefined}>
        <div class="session-main">
          <span class="device">{session.device}</span>
          {#if session.current}<span class="leaf-badge">本机</span>{/if}
          {#if session.remember}<span class="leaf-badge" data-kind="muted">记住 30 天</span>{/if}
        </div>
        <p class="leaf-meta">
          {session.ip ?? '地址未知'} · 登录于 {formatWhen(session.createdAt, timeZone)} · 最近活动 {formatWhen(session.lastSeenAt, timeZone)}
        </p>
        {#if !session.current}
          <button type="button" class="leaf-link sign-out" data-kind="danger" disabled={busy} onclick={() => signOutOne(session)}>
            退出<span class="visually-hidden">「{session.device}」</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="leaf-actions">
    {#if others === 0}
      <span class="leaf-meta">只有这一台设备登录着</span>
    {:else if confirmingAll}
      <span class="leaf-notice">退出另外 {others} 台设备？</span>
      <button type="button" class="leaf-btn" data-kind="primary" disabled={busy} bind:this={othersButton} onclick={signOutOthers}>
        全部退出
      </button>
      <button type="button" class="leaf-link" disabled={busy} onclick={() => (confirmingAll = false)}>算了</button>
    {:else}
      <button type="button" class="leaf-btn" disabled={busy} onclick={askAll}>退出其它设备</button>
    {/if}
  </div>

  {#if notice}<p class="leaf-notice" data-kind={notice.kind} role="status">{notice.text}</p>{/if}
</section>

<style>
  section:focus-visible {
    outline-offset: 4px;
  }

  .sessions {
    display: grid;
    padding: 0;
    list-style: none;
  }

  .session {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-1) var(--space-4);
    align-items: center;
    padding-block: var(--space-3);
    border-block-end: var(--rule-thin);
  }

  .session:first-child {
    padding-block-start: 0;
  }

  /* 本机这一行左边一片花瓣，和首页列表的高亮是同一个记号 */
  .session[data-current]::before {
    position: absolute;
    inset-block-start: calc(var(--space-3) + 0.3rem);
    inset-inline-start: -0.875rem;
    inline-size: 7px;
    block-size: 9px;
    content: '';
    background: var(--sakura-deep);
    mask: var(--petal) center / contain no-repeat;
    rotate: 90deg;
  }

  .session[data-current]:first-child::before {
    inset-block-start: 0.3rem;
  }

  .session-main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .device {
    font-weight: 700;
  }

  .session .leaf-meta {
    grid-column: 1;
  }

  .sign-out {
    grid-row: 1 / span 2;
    grid-column: 2;
  }
</style>
