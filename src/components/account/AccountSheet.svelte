<!--
  个人中心：资料、登录方式、改密码、登录设备，管理员多一块账号管理。整页一个岛屿，几块卡片之间要互相通知
  （改密码会让其它设备退出，设备列表要跟着刷新），初始数据由服务端给好，打开就是完整的，不等接口。
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { AccountView, LoginOptionsView, NoticeView, SessionView, UserView } from '../../lib/account-view';
  import { listSessions, logout } from '../../lib/auth-api';
  import Avatar from '../Avatar.svelte';
  import LoginMethodsCard from './LoginMethodsCard.svelte';
  import PasswordCard from './PasswordCard.svelte';
  import ProfileCard from './ProfileCard.svelte';
  import SessionsCard from './SessionsCard.svelte';
  import UsersCard from './UsersCard.svelte';

  interface Props {
    account: AccountView;
    sessions: readonly SessionView[];
    /** 只有管理员才有 */
    users?: readonly UserView[];
    timeZone: string;
    options: LoginOptionsView;
    /** 第三方绑定 / 注册跳回来时带的提示 */
    notice?: NoticeView;
  }

  let { account, sessions: initialSessions, users, timeZone, options, notice }: Props = $props();

  // 服务端给的只是初始值，之后以接口返回为准
  let sessions = $state(untrack(() => initialSessions));
  let displayName = $state(untrack(() => account.displayName));
  let avatar = $state(untrack(() => account.avatar));
  let hasPassword = $state(untrack(() => account.hasPassword));

  // 提示已经显示了，把 ?notice= 从地址栏去掉，刷新时不再重复
  onMount(() => {
    if (!notice) return;
    const url = new URL(location.href);
    url.searchParams.delete('notice');
    history.replaceState(history.state, '', url);
  });
  let signingOut = $state(false);
  let signOutError = $state<string | undefined>(undefined);

  async function refreshSessions(): Promise<void> {
    try {
      const result = await listSessions();
      if (result.success && result.data) sessions = result.data;
    } catch {
      // 刷新不到就保留原来的列表，下次操作再取
    }
  }

  async function onSignOut(): Promise<void> {
    signingOut = true;
    signOutError = undefined;
    try {
      const result = await logout();
      if (result.success) {
        // 替换掉当前这条历史：登出后按「后退」不会回到个人中心
        location.replace('/');
        return;
      }
      signOutError = result.error ?? '登出失败，请稍后再试';
    } catch {
      signOutError = '网络出了点问题，没能登出';
    }
    signingOut = false;
  }
</script>

<div class="account-head">
  <div>
    <h1 class="account-title">个人中心</h1>
    <p class="account-hello">
      <span class="hello-avatar"><Avatar {avatar} /></span>
      {displayName ?? account.username}
      {#if account.role === 'admin'}<span class="leaf-badge">管理员</span>{/if}
    </p>
  </div>
  <div class="sign-out">
    <button type="button" class="leaf-btn" disabled={signingOut} onclick={onSignOut}>
      {signingOut ? '正在登出…' : '登出'}
    </button>
    {#if signOutError}<p class="leaf-notice" data-kind="error" role="alert">{signOutError}</p>{/if}
  </div>
</div>

{#if notice}
  <p class="leaf-notice page-notice" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
{/if}

<div class="account-grid">
  <ProfileCard {account} {timeZone} bind:displayName bind:avatar />
  <LoginMethodsCard {options} email={account.email} identities={account.identities} {hasPassword} {timeZone} />
  <PasswordCard onchanged={refreshSessions} bind:hasPassword />
  <div class="span-all">
    <SessionsCard {sessions} {timeZone} onchange={refreshSessions} />
  </div>
  {#if users}
    <div class="span-all">
      <UsersCard {users} selfId={account.id} selfAvatar={avatar} {timeZone} />
    </div>
  {/if}
</div>

<style>
  .account-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    padding-block-end: var(--space-3);
    border-block-end: 1px solid var(--ink);
  }

  .account-title {
    font: 700 var(--text-2xl) / 1.3 var(--font-body);
    letter-spacing: 0.12em;
  }

  .account-hello {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-block-start: var(--space-1);
    font: var(--text-base) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .hello-avatar {
    display: block;
    flex: none;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    overflow: hidden;
    border: 1px solid var(--rule);
    border-radius: 50%;
  }

  .sign-out {
    display: grid;
    justify-items: end;
    gap: var(--space-1);
  }

  .page-notice {
    margin-block-start: var(--space-4);
  }

  .account-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr));
    gap: var(--space-6);
  }

  .span-all {
    grid-column: 1 / -1;
  }
</style>
