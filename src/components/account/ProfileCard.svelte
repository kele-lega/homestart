<!--
  个人资料：头像、用户名、角色、注册时间、上次登录；昵称可以改，改完首页上的名字跟着变（下次打开首页时）。
  头像默认是注册时随机定下的色块图，不能挑，只能换成自己上传的图、或者再换回来
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Avatar from '../Avatar.svelte';
  import { formatWhen, type AccountView, type AvatarView } from '../../lib/account-view';
  import { resetAvatar, updateDisplayName, uploadAvatar, type AuthEnvelope } from '../../lib/auth-api';
  import { AVATAR_ACCEPT, AvatarImageError, prepareAvatar } from '../../lib/avatar-image';
  import { isComposing } from '../../lib/keyboard';

  interface Props {
    account: AccountView;
    timeZone: string;
    displayName: string | null;
    avatar: AvatarView;
  }

  let { account, timeZone, displayName = $bindable(), avatar = $bindable() }: Props = $props();

  let editing = $state(false);
  let saving = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);
  let input = $state<HTMLInputElement>();
  let editButton = $state<HTMLButtonElement>();
  let avatarBusy = $state(false);

  async function changeAvatar(run: () => Promise<AuthEnvelope<{ readonly avatar: AvatarView }>>, done: string): Promise<void> {
    avatarBusy = true;
    notice = undefined;
    try {
      const result = await run();
      if (result.success && result.data) {
        avatar = result.data.avatar;
        notice = { kind: 'ok', text: done };
      } else {
        notice = { kind: 'error', text: result.error ?? '保存失败，请稍后再试' };
      }
    } catch (error) {
      notice = { kind: 'error', text: error instanceof AvatarImageError ? error.message : '网络出了点问题，没能保存' };
    }
    avatarBusy = false;
  }

  function onPickAvatar(event: Event): void {
    const picker = event.currentTarget as HTMLInputElement;
    const file = picker.files?.[0];
    // 清掉选择：同一张图删了再选也能触发 change
    picker.value = '';
    if (!file) return;
    void changeAvatar(async () => uploadAvatar(await prepareAvatar(file)), '头像已更新');
  }

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

<section class="leaf-card" id="profile" aria-labelledby="profile-title">
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="profile-title">个人资料</h2>
  </div>

  <dl class="facts">
    <dt>头像</dt>
    <dd class="avatar-row">
      <span class="avatar-preview"><Avatar {avatar} /></span>
      <label class="leaf-link upload" data-busy={avatarBusy || undefined}>
        {avatarBusy ? '正在保存…' : '上传头像'}
        <input
          class="visually-hidden"
          type="file"
          accept={AVATAR_ACCEPT}
          disabled={avatarBusy}
          aria-label="上传头像"
          onchange={onPickAvatar}
        />
      </label>
      {#if avatar.image}
        <button type="button" class="leaf-link" disabled={avatarBusy} onclick={() => changeAvatar(resetAvatar, '已换回默认头像')}>恢复默认</button>
      {/if}
    </dd>

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

  /* 头像这一行按中间对齐：大圆和两个文字按钮放在一条线上 */
  dt:first-of-type {
    align-self: center;
  }

  .avatar-row {
    align-items: center;
    gap: var(--space-3);
  }

  .avatar-preview {
    display: block;
    flex: none;
    inline-size: 3.5rem;
    block-size: 3.5rem;
    overflow: hidden;
    border: 1px solid var(--rule);
    border-radius: 50%;
  }

  .upload {
    cursor: pointer;
  }

  .upload[data-busy] {
    cursor: progress;
  }

  /* 文件框藏起来了，焦点落在它身上时给外面的文字画框 */
  .upload:focus-within {
    outline: 2px solid var(--blue);
    outline-offset: 2px;
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
