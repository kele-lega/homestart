<!--
  管理员的账号管理：列表（昵称、邮箱、注册方式、最近登录）、新建账号、重置密码、删除（要再确认一次，不能删自己）。
  重置密码和删除都会让那个账号已有的登录立即失效
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Avatar from '../Avatar.svelte';
  import { formatWhen, SIGNUP_METHOD_LABELS, type AvatarView, type Role, type UserView } from '../../lib/account-view';
  import { createUser, deleteUser, listUsers, resetPassword } from '../../lib/auth-api';

  interface Props {
    users: readonly UserView[];
    selfId: number;
    /** 自己的头像以个人资料里刚换的为准，不用等重新拉列表 */
    selfAvatar: AvatarView;
    timeZone: string;
  }

  let { users: initialUsers, selfId, selfAvatar, timeZone }: Props = $props();

  type Panel = { readonly kind: 'reset' | 'delete'; readonly id: number } | undefined;

  let users = $state(untrack(() => initialUsers));
  let creating = $state(false);
  let panel = $state<Panel>(undefined);
  let busy = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);
  let section = $state<HTMLElement>();
  let createButton = $state<HTMLButtonElement>();
  let createUsername = $state<HTMLInputElement>();
  let panelFocus = $state<HTMLElement>();

  async function reload(): Promise<void> {
    const result = await listUsers();
    if (result.success && result.data) users = result.data;
  }

  /** 统一收尾：显示结果，焦点落到给定的元素（它不在了就落到卡片上） */
  async function finish(text: string, ok: boolean, focus?: () => HTMLElement | undefined): Promise<void> {
    notice = { kind: ok ? 'ok' : 'error', text };
    busy = false;
    await tick();
    (focus?.() ?? section)?.focus();
  }

  async function openPanel(kind: 'reset' | 'delete', id: number): Promise<void> {
    panel = panel?.kind === kind && panel.id === id ? undefined : { kind, id };
    notice = undefined;
    await tick();
    panelFocus?.focus();
  }

  async function onCreate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const username = String(data.get('username') ?? '');
    const role: Role = data.get('role') === 'admin' ? 'admin' : 'user';
    busy = true;
    notice = undefined;
    try {
      const result = await createUser(username, String(data.get('password') ?? ''), role);
      if (!result.success) return finish(result.error ?? '创建失败，请稍后再试', false, () => createUsername);
      creating = false;
      await reload();
      return finish(`已创建账号 ${username.trim().toLowerCase()}`, true, () => createButton);
    } catch {
      return finish('网络出了点问题，没能创建', false, () => createUsername);
    }
  }

  async function onReset(event: SubmitEvent, user: UserView): Promise<void> {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget as HTMLFormElement).get('password') ?? '');
    busy = true;
    notice = undefined;
    try {
      const result = await resetPassword(user.id, password);
      if (!result.success) return finish(result.error ?? '重置失败，请稍后再试', false, () => panelFocus);
      panel = undefined;
      return finish(`已重置 ${user.username} 的密码，TA 需要用新密码重新登录`, true);
    } catch {
      return finish('网络出了点问题，没能重置', false, () => panelFocus);
    }
  }

  async function onDelete(user: UserView): Promise<void> {
    busy = true;
    notice = undefined;
    try {
      const result = await deleteUser(user.id);
      if (!result.success) return finish(result.error ?? '删除失败，请稍后再试', false);
      panel = undefined;
      await reload();
      return finish(`已删除账号 ${user.username}`, true);
    } catch {
      return finish('网络出了点问题，没能删除', false);
    }
  }

  async function toggleCreate(open: boolean): Promise<void> {
    creating = open;
    notice = undefined;
    await tick();
    (open ? createUsername : createButton)?.focus();
  }
</script>

<section class="leaf-card" id="users" aria-labelledby="users-title" tabindex="-1" bind:this={section}>
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="users-title">账号管理</h2>
    <span class="leaf-card-hint">没有公开注册，账号都在这里开通</span>
  </div>

  <ul class="users" role="list">
    {#each users as user (user.id)}
      <li class="user">
        <div class="user-main">
          <span class="user-avatar"><Avatar avatar={user.id === selfId ? selfAvatar : user.avatar} /></span>
          <span class="username">{user.username}</span>
          {#if user.displayName}<span class="nick">{user.displayName}</span>{/if}
          {#if user.role === 'admin'}<span class="leaf-badge">管理员</span>{/if}
          {#if user.id === selfId}<span class="leaf-badge" data-kind="muted">你</span>{/if}
        </div>
        <p class="leaf-meta">
          {SIGNUP_METHOD_LABELS[user.signupMethod]} · 开通于 {formatWhen(user.createdAt, timeZone).slice(0, 10)} · {user.lastLoginAt === null
            ? '还没登录过'
            : `最近登录 ${formatWhen(user.lastLoginAt, timeZone)}`}
        </p>
        {#if user.email}<p class="leaf-meta email">{user.email}</p>{/if}
        <div class="user-actions">
          <button type="button" class="leaf-link" disabled={busy} onclick={() => openPanel('reset', user.id)}>重置密码</button>
          {#if user.id !== selfId}
            <button type="button" class="leaf-link" data-kind="danger" disabled={busy} onclick={() => openPanel('delete', user.id)}>
              删除
            </button>
          {/if}
        </div>

        {#if panel?.id === user.id && panel.kind === 'reset'}
          <form class="inline-form" onsubmit={(event) => onReset(event, user)}>
            <input
              class="leaf-input"
              type="password"
              name="password"
              placeholder="新密码（至少 8 位）"
              aria-label={`${user.username} 的新密码`}
              required
              autocomplete="new-password"
              bind:this={panelFocus}
            />
            <button type="submit" class="leaf-btn" data-kind="primary" disabled={busy}>保存</button>
          </form>
        {:else if panel?.id === user.id && panel.kind === 'delete'}
          <div class="inline-form">
            <span class="leaf-notice">删除 {user.username}？TA 的登录会立即失效。</span>
            <button type="button" class="leaf-btn" data-kind="primary" disabled={busy} bind:this={panelFocus} onclick={() => onDelete(user)}>
              确认删除
            </button>
            <button type="button" class="leaf-link" disabled={busy} onclick={() => openPanel('delete', user.id)}>算了</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  {#if creating}
    <form class="leaf-form create" onsubmit={onCreate}>
      <label class="leaf-field">
        <span class="leaf-field-label">用户名</span>
        <input class="leaf-input" name="username" required autocomplete="off" autocapitalize="none" bind:this={createUsername} />
      </label>
      <label class="leaf-field">
        <span class="leaf-field-label">初始密码（至少 8 位）</span>
        <input class="leaf-input" type="password" name="password" required autocomplete="new-password" />
      </label>
      <label class="leaf-field">
        <span class="leaf-field-label">角色</span>
        <select class="leaf-input" name="role">
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
      </label>
      <div class="leaf-actions">
        <button type="submit" class="leaf-btn" data-kind="primary" disabled={busy}>创建</button>
        <button type="button" class="leaf-link" disabled={busy} onclick={() => toggleCreate(false)}>取消</button>
      </div>
    </form>
  {:else}
    <div class="leaf-actions">
      <button type="button" class="leaf-btn" bind:this={createButton} onclick={() => toggleCreate(true)}>新建账号</button>
    </div>
  {/if}

  {#if notice}
    <p class="leaf-notice" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
  {/if}
</section>

<style>
  section:focus-visible {
    outline-offset: 4px;
  }

  .users {
    display: grid;
    padding: 0;
    list-style: none;
  }

  .user {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-1) var(--space-4);
    align-items: center;
    padding-block: var(--space-3);
    border-block-end: var(--rule-thin);
  }

  .user:first-child {
    padding-block-start: 0;
  }

  .user-main {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }

  .user-avatar {
    display: block;
    flex: none;
    align-self: center;
    inline-size: 1.375rem;
    block-size: 1.375rem;
    overflow: hidden;
    border: 1px solid var(--rule);
    border-radius: 50%;
  }

  .username {
    font: 700 var(--text-base) / 1.5 var(--num);
  }

  .nick {
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .user .leaf-meta {
    grid-column: 1;
  }

  .user .email {
    overflow-wrap: anywhere;
  }

  .user-actions {
    display: flex;
    grid-row: 1 / span 2;
    grid-column: 2;
    gap: var(--space-3);
  }

  .inline-form {
    display: flex;
    flex-wrap: wrap;
    grid-column: 1 / -1;
    align-items: center;
    gap: var(--space-3);
    padding-block-start: var(--space-2);
  }

  .inline-form .leaf-input {
    flex: 1;
    min-inline-size: 10rem;
  }

  .create {
    padding-block-start: var(--space-2);
  }
</style>
