<!--
  登录方式：绑定 / 换绑邮箱（验证码发到新邮箱），绑定 / 解绑 GitHub、Google。
  绑定是整页跳去对方授权，回来时地址带 ?notice= 说结果。解绑后要至少还剩一种登录方式（密码或另一个第三方），服务端也会再查一遍
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { PROVIDER_LABELS, formatWhen, type IdentityView, type LoginOptionsView, type Provider } from '../../lib/account-view';
  import { changeEmail, oauthStartUrl, requestEmailCode, unlinkIdentity } from '../../lib/auth-api';
  import { CODE_LENGTH, cleanCode, onCodeInput } from '../../lib/verify-code';

  interface Props {
    options: LoginOptionsView;
    email: string | null;
    identities: readonly IdentityView[];
    hasPassword: boolean;
    timeZone: string;
  }

  let { options, email: initialEmail, identities: initialIdentities, hasPassword, timeZone }: Props = $props();

  type Notice = { readonly kind: 'ok' | 'error'; readonly text: string };

  let email = $state(untrack(() => initialEmail));
  let identities = $state(untrack(() => initialIdentities));
  let editing = $state(false);
  let draft = $state('');
  let sent = $state(false);
  let busy = $state(false);
  let emailNotice = $state<Notice | undefined>(undefined);
  let linkNotice = $state<Notice | undefined>(undefined);
  let emailInput = $state<HTMLInputElement>();
  let codeInput = $state<HTMLInputElement>();

  const linked = (provider: Provider) => identities.find((identity) => identity.provider === provider);
  /** 和服务端规则一致：没有密码时，最后一个第三方不能解绑 */
  const canUnlink = $derived(hasPassword || identities.length > 1);
  const shown = $derived(
    [...new Set<Provider>([...options.providers, ...identities.map((identity) => identity.provider)])],
  );

  async function startEditing(): Promise<void> {
    editing = true;
    sent = false;
    draft = '';
    emailNotice = undefined;
    await tick();
    emailInput?.focus();
  }

  async function sendCode(): Promise<void> {
    busy = true;
    emailNotice = undefined;
    try {
      const result = await requestEmailCode(draft);
      if (result.success) {
        sent = true;
        emailNotice = { kind: 'ok', text: '验证码发到新邮箱了，10 分钟内有效' };
        busy = false;
        await tick();
        codeInput?.focus();
        return;
      }
      emailNotice = { kind: 'error', text: result.error ?? '没发出去，请稍后再试' };
    } catch {
      emailNotice = { kind: 'error', text: '网络出了点问题，请稍后再试' };
    }
    busy = false;
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (!sent) return sendCode();
    const code = cleanCode(String(new FormData(event.currentTarget as HTMLFormElement).get('code') ?? ''));
    if (code.length !== CODE_LENGTH) {
      emailNotice = { kind: 'error', text: `验证码是 ${CODE_LENGTH} 位数字` };
      codeInput?.focus();
      return;
    }
    busy = true;
    emailNotice = undefined;
    try {
      const result = await changeEmail(draft, code);
      busy = false;
      if (result.success && result.data) {
        email = result.data.email;
        editing = false;
        emailNotice = { kind: 'ok', text: '邮箱已更新' };
        return;
      }
      emailNotice = { kind: 'error', text: result.error ?? '没改成，请稍后再试' };
    } catch {
      busy = false;
      emailNotice = { kind: 'error', text: '网络出了点问题，请稍后再试' };
    }
    await tick();
    codeInput?.focus();
  }

  async function onUnlink(provider: Provider): Promise<void> {
    busy = true;
    linkNotice = undefined;
    try {
      const result = await unlinkIdentity(provider);
      if (result.success) {
        identities = identities.filter((identity) => identity.provider !== provider);
        linkNotice = { kind: 'ok', text: `已解绑 ${PROVIDER_LABELS[provider]}` };
      } else {
        linkNotice = { kind: 'error', text: result.error ?? '解绑失败，请稍后再试' };
      }
    } catch {
      linkNotice = { kind: 'error', text: '网络出了点问题，没能解绑' };
    }
    busy = false;
  }
</script>
<section class="leaf-card" id="login-methods" aria-labelledby="login-methods-title">
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="login-methods-title">登录方式</h2>
    <span class="leaf-card-hint">邮箱可以代替用户名登录，也用来找回密码</span>
  </div>

  <dl class="facts">
    <dt>邮箱</dt>
    <dd>
      {#if editing}
        <form class="email-form" onsubmit={onSubmit}>
          <input
            class="leaf-input"
            type="email"
            name="email"
            required
            maxlength="254"
            placeholder="新邮箱"
            aria-label="新邮箱"
            autocomplete="email"
            autocapitalize="none"
            spellcheck="false"
            bind:value={draft}
            bind:this={emailInput}
            oninput={() => (sent = false)}
          />
          {#if sent}
            <input
              class="leaf-input"
              type="text"
              name="code"
              required
              inputmode="numeric"
              placeholder="6 位验证码"
              aria-label="验证码"
              autocomplete="one-time-code"
              oninput={onCodeInput}
              bind:this={codeInput}
            />
          {/if}
          <div class="leaf-actions">
            <button type="submit" class="leaf-btn" data-kind="primary" disabled={busy}>{sent ? '确认' : '发送验证码'}</button>
            {#if sent}
              <button type="button" class="leaf-link" disabled={busy} onclick={sendCode}>重新发送</button>
            {/if}
            <button type="button" class="leaf-link" disabled={busy} onclick={() => (editing = false)}>取消</button>
          </div>
        </form>
      {:else}
        <span class="value mono">{email ?? '未绑定'}</span>
        {#if options.email}
          <button type="button" class="leaf-link" onclick={startEditing}>{email ? '换绑' : '绑定'}</button>
        {/if}
      {/if}
    </dd>

    {#each shown as provider (provider)}
      {@const identity = linked(provider)}
      <dt>{PROVIDER_LABELS[provider]}</dt>
      <dd>
        {#if identity}
          <span class="value">{identity.label}</span>
          <span class="leaf-meta">绑定于 {formatWhen(identity.createdAt, timeZone).slice(0, 10)}</span>
          <button
            type="button"
            class="leaf-link"
            data-kind="danger"
            disabled={busy || !canUnlink}
            title={canUnlink ? undefined : '这是唯一的登录方式，先设置密码或绑定另一个'}
            onclick={() => onUnlink(provider)}>解绑</button
          >
        {:else}
          <span class="leaf-meta">未绑定</span>
          {#if options.providers.includes(provider)}
            <a class="leaf-link" href={oauthStartUrl(provider, 'link')}>绑定</a>
          {/if}
        {/if}
      </dd>
    {/each}
  </dl>

  {#if emailNotice}
    <p class="leaf-notice" data-kind={emailNotice.kind} role={emailNotice.kind === 'error' ? 'alert' : 'status'}>{emailNotice.text}</p>
  {/if}
  {#if linkNotice}
    <p class="leaf-notice" data-kind={linkNotice.kind} role={linkNotice.kind === 'error' ? 'alert' : 'status'}>{linkNotice.text}</p>
  {/if}
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

  .value {
    overflow-wrap: anywhere;
  }

  .email-form {
    display: grid;
    gap: var(--space-2);
    inline-size: 100%;
  }
</style>
