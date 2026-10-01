<!-- 个人资料：用户名、角色、注册时间、上次登录；昵称可以改，改完书签上的字跟着变（下次打开首页时） -->
<script lang="ts">
  import { tick } from 'svelte';
  import { formatWhen, type AccountView } from '../../lib/account-view';
  import { updateDisplayName } from '../../lib/auth-api';
  import { isComposing } from '../../lib/keyboard';

  interface Props {
    account: AccountView;
    timeZone: string;
    displayName: string | null;
  }

  let { account, timeZone, displayName = $bindable() }: Props = $props();

  let editing = $state(false);
  let saving = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);
  let input = $state<HTMLInputElement>();
  let editButton = $state<HTMLButtonElement>();

  async function startEditing(): Promise<void> {
    editing = true;
    notice = undefined;
    await tick();
    input?.focus();
    input?.select();
  }

  async function stopEditing(): Promise<void> {
    editing = false;
    await tick();
    editButton?.focus();
  }

  async function onSave(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    saving = true;
    notice = undefined;
    try {
      const result = await updateDisplayName(input?.value ?? '');
      if (result.success && result.data) {
        displayName = result.data.displayName;
        notice = { kind: 'ok', text: displayName ? '昵称已保存' : '已清除昵称，显示用户名' };
        saving = false;
        await stopEditing();
        return;
      }
      notice = { kind: 'error', text: result.error ?? '保存失败，请稍后再试' };
    } catch {
      notice = { kind: 'error', text: '网络出了点问题，没能保存' };
    }
    saving = false;
    await tick();
    input?.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || isComposing(event)) return;
    event.preventDefault();
    void stopEditing();
  }
</script>

<section class="leaf-card" aria-labelledby="profile-title">
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="profile-title">个人资料</h2>
  </div>

  <dl class="facts">
    <dt>用户名</dt>
    <dd class="mono">{account.username}</dd>

    <dt>昵称</dt>
    <dd>
      {#if editing}
        <form class="name-form" onsubmit={onSave}>
          <input
            class="leaf-input"
            name="displayName"
            value={displayName ?? ''}
            maxlength="32"
            placeholder="留空则显示用户名"
            aria-label="昵称"
            autocomplete="nickname"
            bind:this={input}
            onkeydown={onKeydown}
          />
          <div class="leaf-actions">
            <button type="submit" class="leaf-btn" data-kind="primary" disabled={saving}>保存</button>
            <button type="button" class="leaf-link" disabled={saving} onclick={stopEditing}>取消</button>
          </div>
        </form>
      {:else}
        <span class="name">{displayName ?? '未设置'}</span>
        <button type="button" class="leaf-link" bind:this={editButton} onclick={startEditing}>修改</button>
      {/if}
    </dd>

    <dt>角色</dt>
    <dd>{account.role === 'admin' ? '管理员' : '普通用户'}</dd>

    <dt>开通于</dt>
    <dd class="mono">{formatWhen(account.createdAt, timeZone).slice(0, 10)}</dd>

    <dt>上次登录</dt>
    <dd class="mono">
      {#if account.previousLogin}
        {formatWhen(account.previousLogin.at, timeZone)}
        {#if account.previousLogin.ip}<span class="leaf-meta">· {account.previousLogin.ip}</span>{/if}
      {:else}
        <span class="leaf-meta">这是第一次登录</span>
      {/if}
    </dd>
  </dl>

  {#if notice}<p class="leaf-notice" data-kind={notice.kind} role="status">{notice.text}</p>{/if}
</section>

<style>
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-3) var(--space-4);
    align-items: baseline;
  }

  dt {
    font: var(--text-xs) / 1.5 var(--label);
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }

  dd {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    min-inline-size: 0;
    font-size: var(--text-base);
  }

  .mono {
    font-family: var(--num);
  }

  .name {
    overflow-wrap: anywhere;
  }

  .name-form {
    display: grid;
    gap: var(--space-2);
    inline-size: 100%;
  }
</style>
