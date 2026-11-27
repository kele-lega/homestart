<!--
  个人中心：资料、登录方式和密码、登录设备，管理员多一卷账号管理。和设置页一样，页面上只摆几格器物（ScrollShelf），
  一格一卷，点开是挂轴；/account#sessions 这样的地址直接展开那一卷。
  整页一个岛屿，几张卡片之间要互相通知（改密码会让其它设备退出，设备列表要跟着刷新），初始数据由服务端给好，打开就是完整的，不等接口。
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { AccountView, LoginOptionsView, NoticeView, SessionView, UserView } from '../../lib/account-view';
  import { listSessions, logout } from '../../lib/auth-api';
  import Avatar from '../Avatar.svelte';
  import ScrollShelf from '../ScrollShelf.svelte';
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
  /** 四卷：资料、安全（登录方式和密码）、设备，管理员多一卷账号管理 */
  const juans = $derived([
    { id: 'me', name: '资料', cards: [['profile', '个人资料']] as const, sum: '昵称 · 头像' },
    {
      id: 'safe',
      name: '安全',
      cards: [
        ['login-methods', '登录方式'],
        ['password', hasPassword ? '修改密码' : '设置密码'],
      ] as const,
    },
    { id: 'devices', name: '设备', cards: [['sessions', '登录设备']] as const, sum: `${sessions.length} 处登录着` },
    ...(users ? [{ id: 'admin', name: '管理', cards: [['users', '账号管理']] as const, sum: `${users.length} 个账号` }] : []),
  ]);

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
  <h1 class="account-title">个人中心</h1>
  <p class="account-hello">
    <span class="hello-avatar"><Avatar {avatar} /></span>
    {displayName ?? account.username}
    {#if account.role === 'admin'}<span class="leaf-badge">管理员</span>{/if}
  </p>
  <div class="sign-out">
    <button type="button" class="leaf-link" disabled={signingOut} onclick={onSignOut}>
      {signingOut ? '正在登出…' : '登出'}
    </button>
    {#if signOutError}<p class="leaf-notice" data-kind="error" role="alert">{signOutError}</p>{/if}
  </div>
</div>

{#if notice}
  <p class="leaf-notice page-notice" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
{/if}

<ScrollShelf {juans}>
  {#snippet icon(id: string)}
    {#if id === 'me'}
      <!-- 一方印：上头一个钮，下面盖出来一方朱砂 -->
      <path d="M16 11.6 C14.4 10.4 14.6 6.4 17.4 5.6 C18.6 3.6 21.4 3.6 22.6 5.6 C25.4 6.4 25.6 10.4 24 11.6 Z" />
      <rect x="13.4" y="11.6" width="13.2" height="13.2" rx="1" />
      <path class="faint" d="M13.4 21.4 H26.6" />
      <rect class="dan" x="15" y="29" width="10" height="8.4" rx=".6" />
    {:else if id === 'safe'}
      <!-- 一把横锁：弯梁、锁身，朱砂的锁孔，底下垂一截穗子 -->
      <path d="M12.4 21.4 V15.4 C12.4 8.6 27.6 8.6 27.6 15.4 V18.6" />
      <path d="M7.6 21.4 H32.4 L30.6 29.6 H9.4 Z" />
      <path class="faint" d="M10.8 25.4 H29.2" />
      <rect class="dan" x="18.6" y="23" width="2.8" height="4.6" rx=".6" />
      <path class="faint" d="M20 29.6 V35 M18.8 33.4 L18.4 37.4 M21.2 33.4 L21.6 37.4" />
    {:else if id === 'devices'}
      <!-- 一面令牌：顶上穿绳，正中一方朱砂 -->
      <path class="faint" d="M20 8.6 C17.6 5.4 22.4 4 20 1.4" />
      <path d="M13 7.4 H27 V30 L20 36.6 L13 30 Z" />
      <circle cx="20" cy="10.6" r="1.4" />
      <rect class="dan" x="17.2" y="15.6" width="5.6" height="9.6" rx=".6" />
    {:else}
      <!-- 一册线装的名册：左边四道线，右上一条朱砂题签 -->
      <rect x="9" y="6.6" width="22.4" height="27.4" rx="1" />
      <path class="faint" d="M13.4 6.6 V34" />
      <path d="M9 11.6 H13.4 M9 17.6 H13.4 M9 23.6 H13.4 M9 29.6 H13.4" />
      <rect class="dan" x="23" y="10" width="4.2" height="12.4" rx=".4" />
    {/if}
  {/snippet}
  {#snippet content(id: string)}
    {#if id === 'me'}
      <ProfileCard {account} {timeZone} bind:displayName bind:avatar />
    {:else if id === 'safe'}
      <LoginMethodsCard {options} email={account.email} identities={account.identities} {hasPassword} {timeZone} />
      <PasswordCard onchanged={refreshSessions} bind:hasPassword />
    {:else if id === 'devices'}
      <SessionsCard {sessions} {timeZone} onchange={refreshSessions} />
    {:else if users}
      <UsersCard {users} selfId={account.id} selfAvatar={avatar} {timeZone} />
    {/if}
  {/snippet}
</ScrollShelf>

<style>
  .account-head {
    display: grid;
    justify-items: center;
    gap: 0.7rem;
    margin-block: 1rem 3.2rem;
    text-align: center;
  }

  .account-title {
    margin-inline-end: -0.6em;
    font: 400 2.4rem / 1.2 var(--brush);
    letter-spacing: 0.6em;
  }

  .account-hello {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font: 0.95rem / 1.5 var(--song);
    letter-spacing: 0.06em;
    color: var(--ink-2);
  }

  .hello-avatar {
    display: block;
    flex: none;
    inline-size: 1.6rem;
    block-size: 1.6rem;
    overflow: hidden;
    border: 1px solid var(--rule);
    border-radius: 50%;
  }

  .sign-out {
    display: grid;
    justify-items: center;
    gap: 0.3rem;
  }

  .page-notice {
    margin-block: -1.6rem 2rem;
    text-align: center;
  }
</style>
