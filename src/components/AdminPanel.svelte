<!-- 管理员的账号管理面板：模态浮层，居中弹出。新建账号、重置密码、删除账号（不能删自己） -->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { createUser, deleteUser, listUsers, resetPassword, type UserSummary } from '../lib/auth-api';
  import { isComposing } from '../lib/keyboard';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let users = $state<readonly UserSummary[]>([]);
  let loading = $state(true);
  let loadError = $state<string | undefined>(undefined);
  let dialog = $state<HTMLDivElement>();
  let closeButton = $state<HTMLButtonElement>();

  let creating = $state(false);
  let createError = $state<string | undefined>(undefined);
  let resettingId = $state<number | undefined>(undefined);
  let resetError = $state<string | undefined>(undefined);
  let busy = $state(false);
  let createButton = $state<HTMLButtonElement>();
  let createUsernameInput = $state<HTMLInputElement>();
  let resetInputs = new Map<number, HTMLInputElement>();

  async function reload(): Promise<void> {
    loading = true;
    loadError = undefined;
    try {
      const result = await listUsers();
      if (result.success && result.data) {
        users = result.data;
      } else {
        loadError = result.error ?? '账号列表没有取到';
      }
    } catch {
      loadError = '账号列表没有取到';
    }
    loading = false;
  }

  onMount(() => {
    void reload();
    void tick().then(() => closeButton?.focus());
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || isComposing(event)) return;
    event.preventDefault();
    onclose();
  }

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onclose();
  }

  async function onCreate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const username = String(data.get('username') ?? '');
    const password = String(data.get('password') ?? '');
    const role = data.get('role') === 'admin' ? 'admin' : 'user';
    busy = true;
    createError = undefined;
    try {
      const result = await createUser(username, password, role);
      if (result.success) {
        creating = false;
        form.reset();
        await reload();
        // 表单消失后重新出现的是「新建账号」按钮：焦点从即将被移除的提交按钮上挪过去，不会掉回 body
        await tick();
        createButton?.focus();
      } else {
        createError = result.error ?? '创建失败，请稍后再试';
      }
    } catch {
      createError = '创建失败，请稍后再试';
    }
    busy = false;
    // 提交按钮短暂 disabled 会把焦点踢到 body：失败时留在表单里，还给用户名输入框
    if (createError) {
      await tick();
      createUsernameInput?.focus();
    }
  }

  async function onResetSubmit(event: SubmitEvent, id: number): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const password = String(new FormData(form).get('password') ?? '');
    busy = true;
    resetError = undefined;
    try {
      const result = await resetPassword(id, password);
      if (result.success) {
        resettingId = undefined;
      } else {
        resetError = result.error ?? '重置失败，请稍后再试';
      }
    } catch {
      resetError = '重置失败，请稍后再试';
    }
    busy = false;
    if (resetError) {
      await tick();
      resetInputs.get(id)?.focus();
    }
  }

  /** 每行的重置密码输入框注册到 resetInputs，失败时把焦点还给对应那一行 */
  function registerResetInput(node: HTMLInputElement, id: number): { destroy(): void } {
    resetInputs.set(id, node);
    return {
      destroy() {
        resetInputs.delete(id);
      },
    };
  }

  async function onDelete(id: number): Promise<void> {
    busy = true;
    try {
      await deleteUser(id);
      await reload();
      // 这一行本身消失了，没有更稳妥的落点：焦点还给对话框本身，Esc、Tab 都还能用
      await tick();
      dialog?.focus();
    } catch {
      loadError = '删除失败，请稍后再试';
    }
    busy = false;
  }

  const formatDate = (ms: number) => new Date(ms).toLocaleDateString('zh-CN');
</script>

<div class="backdrop" role="presentation" onmousedown={onBackdropClick}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="管理账号" tabindex="-1" bind:this={dialog} onkeydown={onKeydown}>
    <div class="head">
      <h2 class="title">管理账号</h2>
      <button type="button" class="close" bind:this={closeButton} onclick={onclose} aria-label="关闭">×</button>
    </div>

    {#if loading}
      <p class="notice">正在读取账号列表…</p>
    {:else if loadError}
      <p class="notice" data-kind="error">
        {loadError}
        <button type="button" class="link-btn" onclick={reload}>重试</button>
      </p>
    {:else}
      <ul class="users" role="list">
        {#each users as row (row.id)}
          <li class="user-row">
            <div class="user-main">
              <span class="username">{row.username}</span>
              {#if row.role === 'admin'}<span class="role">管理员</span>{/if}
              <span class="created">{formatDate(row.createdAt)}</span>
            </div>
            <div class="user-actions">
              <button type="button" class="link-btn" disabled={busy} onclick={() => (resettingId = resettingId === row.id ? undefined : row.id)}>
                重置密码
              </button>
              <button type="button" class="link-btn danger" disabled={busy} onclick={() => onDelete(row.id)}>删除</button>
            </div>
            {#if resettingId === row.id}
              <form class="inline-form" onsubmit={(event) => onResetSubmit(event, row.id)}>
                <input
                  type="password"
                  name="password"
                  placeholder="新密码（至少 8 位）"
                  required
                  autocomplete="new-password"
                  use:registerResetInput={row.id}
                />
                <button type="submit" class="btn primary" disabled={busy}>保存</button>
              </form>
              {#if resetError}<p class="notice" data-kind="error">{resetError}</p>{/if}
            {/if}
          </li>
        {:else}
          <li class="notice">还没有其他账号</li>
        {/each}
      </ul>
    {/if}

    <div class="create-section">
      {#if creating}
        <form class="create-form" onsubmit={onCreate}>
          <label class="field">
            <span class="field-label">用户名</span>
            <input type="text" name="username" required autocomplete="off" bind:this={createUsernameInput} />
          </label>
          <label class="field">
            <span class="field-label">密码</span>
            <input type="password" name="password" required autocomplete="new-password" />
          </label>
          <label class="field">
            <span class="field-label">角色</span>
            <select name="role">
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <div class="actions">
            <button type="submit" class="btn primary" disabled={busy}>创建</button>
            <button
              type="button"
              class="btn"
              disabled={busy}
              onclick={async () => {
                creating = false;
                await tick();
                createButton?.focus();
              }}
            >
              取消
            </button>
          </div>
          {#if createError}<p class="notice" data-kind="error">{createError}</p>{/if}
        </form>
      {:else}
        <button type="button" class="btn primary" bind:this={createButton} onclick={() => (creating = true)}>新建账号</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) + 10);
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: color-mix(in srgb, var(--ink) 45%, transparent);
    opacity: 0;
    animation: fade-in var(--dur-open) var(--ease-out) forwards;
  }

  @keyframes fade-in {
    to {
      opacity: 1;
    }
  }

  .dialog {
    inline-size: min(28rem, 100%);
    max-block-size: min(34rem, 90dvh);
    overflow-y: auto;
    padding: 1.25rem;
    background: var(--surface);
    border: var(--rule-thin);
    border-block-start: 4px solid var(--sakura-deep);
    box-shadow: var(--lift);
    scale: 0.96;
    translate: 0 6px;
    animation: pop-in var(--dur-open) var(--spring) forwards;
  }

  @keyframes pop-in {
    to {
      scale: 1;
      translate: none;
    }
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-block-end: 0.75rem;
  }

  .title {
    font: 400 var(--text-2xl) / 1 var(--serif);
  }

  .close {
    padding: 0.25rem 0.5rem;
    font-size: var(--text-xl);
    line-height: 1;
    color: var(--ink-3);
    background: none;
    border: 0;
  }

  .users {
    padding: 0;
    margin-block-end: 0.75rem;
    list-style: none;
    border-top: var(--rule-thin);
  }

  .user-row {
    padding-block: 0.625rem;
    border-bottom: var(--rule-thin);
  }

  .user-main {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-block-end: 0.25rem;
  }

  .username {
    font-weight: 700;
  }

  .role {
    padding: 0.0625rem 0.375rem;
    font-size: var(--text-2xs);
    color: var(--sakura-deep);
    border: 1px solid var(--sakura-deep);
    border-radius: 999px;
  }

  .created {
    margin-inline-start: auto;
    font: var(--text-xs) / 1.5 var(--num);
    color: var(--ink-3);
  }

  .user-actions {
    display: flex;
    gap: 0.75rem;
    font: var(--text-sm) / 1.5 var(--label);
  }

  .link-btn {
    padding: 0;
    color: var(--blue);
    background: none;
    border: 0;
  }

  .link-btn.danger {
    color: var(--red);
  }

  .link-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .inline-form {
    display: flex;
    gap: 0.5rem;
    margin-block-start: 0.5rem;
  }

  .inline-form input {
    flex: 1;
    min-inline-size: 0;
    padding: 0.25rem 0.5rem;
    font: var(--text-sm) / 1.4 var(--num);
    background: var(--paper);
    border: 1px solid var(--ink-3);
  }

  .create-form,
  .field {
    display: grid;
    gap: 0.5rem;
  }

  .field-label {
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--ink-3);
  }

  .field input,
  .field select {
    inline-size: 100%;
    padding: 0.25rem 0;
    font: var(--text-lg) / 1.4 var(--num);
    color: var(--ink);
    background: none;
    border: 0;
    border-bottom: 1px solid var(--ink-3);
    border-radius: 0;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.25rem 0.875rem;
    font: var(--text-sm) / 1.5 var(--label);
    border: 1px solid var(--ink-2);
  }

  .btn.primary {
    color: var(--paper);
    background: var(--ink);
    border-color: var(--ink);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .notice {
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .notice[data-kind='error'] {
    color: var(--red);
  }
</style>
