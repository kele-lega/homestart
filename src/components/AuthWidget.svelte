<!--
  页头的登录入口：未登录显示「登录」，点开居中的登录模态框（页头太窄，放不下下拉面板）。
  登录成功后按钮换成用户名，管理员多一个「管理账号」入口打开 AdminPanel。
  登录状态只在这次页面停留期间记在内存里，刷新页面会重新问一次 /api/auth/me（Cookie 还在，不用重新登录）。
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fetchMe, logout, type CurrentUser } from '../lib/auth-api';
  import AdminPanel from './AdminPanel.svelte';
  import LoginDialog from './LoginDialog.svelte';

  let user = $state<CurrentUser | undefined>(undefined);
  let ready = $state(false);
  let loginOpen = $state(false);
  let adminOpen = $state(false);
  let pending = $state(false);
  let loginButton = $state<HTMLButtonElement>();

  onMount(() => {
    void fetchMe().then((result) => {
      user = result.data ?? undefined;
      ready = true;
    });
  });

  function onLoginSuccess(signedIn: CurrentUser): void {
    user = signedIn;
    loginOpen = false;
    void tick().then(() => loginButton?.focus());
  }

  function closeLogin(): void {
    loginOpen = false;
    void tick().then(() => loginButton?.focus());
  }

  async function onLogout(): Promise<void> {
    pending = true;
    await logout().catch(() => undefined);
    user = undefined;
    adminOpen = false;
    pending = false;
    // 「登出」按钮换成了「登录」按钮：焦点从即将消失的按钮上挪过去，不会掉回 body
    await tick();
    loginButton?.focus();
  }
</script>

<div class="auth-widget" class:ready>
  {#if user}
    <span class="who">
      {user.username}
      {#if user.role === 'admin'}<span class="role">管理员</span>{/if}
    </span>
    {#if user.role === 'admin'}
      <button type="button" class="link-btn" onclick={() => (adminOpen = true)}>管理账号</button>
    {/if}
    <button type="button" class="link-btn" disabled={pending} onclick={onLogout}>登出</button>
  {:else}
    <button type="button" class="link-btn" bind:this={loginButton} onclick={() => (loginOpen = true)}>登录</button>
  {/if}
</div>

{#if loginOpen}
  <LoginDialog onclose={closeLogin} onsuccess={onLoginSuccess} />
{/if}

{#if adminOpen}
  <AdminPanel onclose={() => (adminOpen = false)} />
{/if}

<style>
  .auth-widget {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-3);
    /* /me 还没回来之前不显示任何按钮，避免先闪一下「登录」再换成用户名 */
    visibility: hidden;
  }

  .auth-widget.ready {
    visibility: visible;
  }

  .who {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
    color: var(--ink-2);
  }

  .role {
    padding: 0.0625rem 0.375rem;
    font-size: var(--text-2xs);
    color: var(--sakura-deep);
    border: 1px solid var(--sakura-deep);
    border-radius: 999px;
  }

  .link-btn {
    padding: 0;
    font: inherit;
    color: var(--blue);
    background: none;
    border: 0;
  }

  .link-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (hover: hover) {
    .link-btn:not(:disabled):hover {
      text-decoration: underline;
    }
  }
</style>
