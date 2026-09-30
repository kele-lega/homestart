<!-- 登录模态框：与 AdminPanel 同样的居中弹出动画（遮罩淡入 + 对话框回弹），页头太窄放不下下拉面板 -->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { login, type CurrentUser } from '../lib/auth-api';
  import { isComposing } from '../lib/keyboard';

  interface Props {
    onclose: () => void;
    onsuccess: (user: CurrentUser) => void;
  }

  let { onclose, onsuccess }: Props = $props();

  let pending = $state(false);
  let error = $state<string | undefined>(undefined);
  let usernameInput = $state<HTMLInputElement>();

  onMount(() => {
    void tick().then(() => usernameInput?.focus());
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || isComposing(event)) return;
    event.preventDefault();
    onclose();
  }

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onclose();
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const username = String(data.get('username') ?? '');
    const password = String(data.get('password') ?? '');
    pending = true;
    error = undefined;
    try {
      const result = await login(username, password);
      if (result.success && result.data) {
        onsuccess(result.data);
      } else {
        error = result.error ?? '登录失败，请稍后再试';
      }
    } catch {
      error = '登录失败，请稍后再试';
    }
    pending = false;
  }
</script>

<div class="backdrop" role="presentation" onmousedown={onBackdropClick}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="登录" tabindex="-1" onkeydown={onKeydown}>
    <div class="head">
      <h2 class="title">登录</h2>
      <button type="button" class="close" onclick={onclose} aria-label="关闭">×</button>
    </div>
    <form class="login-form" onsubmit={onSubmit}>
      <label class="field">
        <span class="field-label">用户名</span>
        <input bind:this={usernameInput} type="text" name="username" required autocomplete="username" />
      </label>
      <label class="field">
        <span class="field-label">密码</span>
        <input type="password" name="password" required autocomplete="current-password" />
      </label>
      <div class="actions">
        <button type="submit" class="btn primary" disabled={pending}>登录</button>
        <button type="button" class="btn" disabled={pending} onclick={onclose}>取消</button>
      </div>
      <p class="status" role="status" data-kind={error ? 'error' : undefined}>{error ?? ''}</p>
    </form>
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
    inline-size: min(20rem, 100%);
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

  .login-form {
    display: grid;
    gap: 0.625rem;
  }

  .field {
    display: grid;
    gap: 0.25rem;
  }

  .field-label {
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--ink-3);
  }

  .field input {
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

  .status {
    min-block-size: 1.1em;
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .status[data-kind='error'] {
    color: var(--red);
  }
</style>
