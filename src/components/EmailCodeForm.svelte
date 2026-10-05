<!--
  注册和找回密码共用的表单卡片：先填邮箱（过一下人机验证）发验证码，验证码发出去后下面再展开第二步。
  注册的第二步是用户名 + 密码，找回的是新密码；成功后都直接登录、回首页。
  邮箱栏一直在：填错了改掉再点「重新发送」就行，不用来回切步骤
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { requestResetCode, requestSignupCode, resetPasswordWithCode, signup } from '../lib/auth-api';
  import type { LoginOptionsView } from '../lib/account-view';
  import { SIGNED_IN_FLAG } from '../lib/page-turn';
  import { CODE_LENGTH, cleanCode, onCodeInput } from '../lib/verify-code';
  import Turnstile from './Turnstile.svelte';

  interface Props {
    kind: 'signup' | 'reset';
    options: LoginOptionsView;
  }

  let { kind, options }: Props = $props();

  const MIN_LENGTH = 8;
  /** 和服务端的重发冷却一致（adapters/auth/email-codes.ts） */
  const RESEND_WAIT_S = 60;
  const DONE_PAUSE_MS = 480;

  type Notice = { readonly kind: 'ok' | 'error'; readonly text: string };

  let hydrated = $state(false);
  let sending = $state(false);
  let submitting = $state(false);
  let sent = $state(false);
  let wait = $state(0);
  let token = $state('');
  let sendNotice = $state<Notice | undefined>(undefined);
  let notice = $state<Notice | undefined>(undefined);
  let done = $state('');
  let email = $state('');
  let turnstile = $state<ReturnType<typeof Turnstile>>();
  let codeInput = $state<HTMLInputElement>();
  let passwordInput = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const needsHuman = $derived(options.turnstileSiteKey !== null);
  const canSend = $derived(hydrated && !sending && wait === 0 && (!needsHuman || token !== ''));

  onMount(() => {
    hydrated = true;
    return () => clearInterval(timer);
  });

  function startWait(): void {
    wait = RESEND_WAIT_S;
    clearInterval(timer);
    timer = setInterval(() => {
      wait -= 1;
      if (wait <= 0) clearInterval(timer);
    }, 1000);
  }

  async function sendCode(): Promise<void> {
    if (!canSend) return;
    sending = true;
    sendNotice = undefined;
    try {
      const result = await (kind === 'signup' ? requestSignupCode : requestResetCode)(email, token);
      if (result.success) {
        sent = true;
        startWait();
        sendNotice = { kind: 'ok', text: '验证码发出去了，10 分钟内有效；没收到看看垃圾邮件' };
        await tick();
        codeInput?.focus();
      } else {
        sendNotice = { kind: 'error', text: result.error ?? '没发出去，请稍后再试' };
      }
    } catch {
      sendNotice = { kind: 'error', text: '网络出了点问题，请稍后再试' };
    }
    sending = false;
    // 令牌只能用一次，不管成没成都换一个
    turnstile?.reset();
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    // 第二步还没展开时在邮箱栏按回车，等于点「发送验证码」
    if (!sent) return sendCode();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const code = cleanCode(String(data.get('code') ?? ''));
    if (code.length !== CODE_LENGTH) return fail(`验证码是 ${CODE_LENGTH} 位数字`);
    const password = String(data.get('password') ?? '');
    if (password.length < MIN_LENGTH) return fail(`密码至少 ${MIN_LENGTH} 位`);
    if (password !== String(data.get('confirm') ?? '')) return fail('两次输入的密码不一样');

    submitting = true;
    notice = undefined;
    try {
      const result =
        kind === 'signup'
          ? await signup({ email, code, username: String(data.get('username') ?? ''), password, remember: data.get('remember') === 'on' })
          : await resetPasswordWithCode(email, code, password);
      if (result.success && result.data) {
        done = kind === 'signup' ? `欢迎，${result.data.displayName ?? result.data.username}` : '密码已重设';
        try {
          sessionStorage.setItem(SIGNED_IN_FLAG, '1');
        } catch {
          // 存储不可用：首页只是少了头像弹出来的那一下
        }
        setTimeout(() => location.replace('/'), DONE_PAUSE_MS);
        return;
      }
      submitting = false;
      return fail(result.error ?? '没成功，请稍后再试');
    } catch {
      submitting = false;
      return fail('网络出了点问题，请稍后再试');
    }
  }

  async function fail(text: string): Promise<void> {
    notice = { kind: 'error', text };
    await tick();
    (text.includes('验证码') ? codeInput : passwordInput)?.focus();
  }
</script>
<div class="leaf-card code-card" data-status={done ? 'success' : submitting ? 'pending' : 'idle'}>
  <div class="leaf-card-head">
    <h1 class="leaf-card-title">{kind === 'signup' ? '注册' : '找回密码'}</h1>
    <span class="leaf-card-hint">{kind === 'signup' ? '先验证邮箱' : '验证码发到注册时的邮箱'}</span>
  </div>

  {#if !options.email}
    <p class="leaf-notice" data-kind="error">本站还没开通邮件，暂时不能用邮箱{kind === 'signup' ? '注册' : '找回密码'}</p>
  {:else}
    <form class="leaf-form" method="post" onsubmit={onSubmit}>
      <label class="leaf-field">
        <span class="leaf-field-label">邮箱</span>
        <input
          class="leaf-input"
          type="email"
          name="email"
          required
          maxlength="254"
          autocomplete="email"
          autocapitalize="none"
          spellcheck="false"
          bind:value={email}
        />
      </label>
      {#if options.turnstileSiteKey}
        <Turnstile siteKey={options.turnstileSiteKey} bind:token bind:this={turnstile} />
      {/if}
      <div class="leaf-actions">
        <button type="button" class="leaf-btn" disabled={!canSend || email.trim() === ''} onclick={sendCode}>
          {sending ? '正在发送…' : wait > 0 ? `${wait} 秒后可重发` : sent ? '重新发送' : '发送验证码'}
        </button>
      </div>
      <p class="slot" aria-live="polite">
        {#if sendNotice}
          <span class="leaf-notice" data-kind={sendNotice.kind}>{sendNotice.text}</span>
        {/if}
      </p>

      {#if sent}
        <label class="leaf-field">
          <span class="leaf-field-label">验证码</span>
          <input
            class="leaf-input"
            type="text"
            name="code"
            required
            inputmode="numeric"
            autocomplete="one-time-code"
            oninput={onCodeInput}
            bind:this={codeInput}
          />
        </label>
        {#if kind === 'signup'}
          <label class="leaf-field">
            <span class="leaf-field-label">用户名</span>
            <input
              class="leaf-input"
              type="text"
              name="username"
              required
              minlength="3"
              maxlength="32"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              aria-describedby="username-hint"
            />
          </label>
          <p class="leaf-meta" id="username-hint">3-32 位小写字母、数字和 . _ -；注册后不能改</p>
        {/if}
        <label class="leaf-field">
          <span class="leaf-field-label">{kind === 'signup' ? '密码' : '新密码'}</span>
          <input
            class="leaf-input"
            type="password"
            name="password"
            required
            minlength={MIN_LENGTH}
            autocomplete="new-password"
            bind:this={passwordInput}
          />
        </label>
        <label class="leaf-field">
          <span class="leaf-field-label">再输一遍</span>
          <input class="leaf-input" type="password" name="confirm" required autocomplete="new-password" />
        </label>
        {#if kind === 'signup'}
          <label class="leaf-check">
            <input type="checkbox" name="remember" />
            记住我（30 天内免登录）
          </label>
        {/if}

        <p class="slot" aria-live="polite">
          {#if notice}
            <span class="leaf-notice" data-kind={notice.kind}>{notice.text}</span>
          {/if}
        </p>

        <button type="submit" class="leaf-btn" data-kind="wide" disabled={!hydrated || submitting}>
          {#if done}
            {done}
          {:else if submitting}
            正在提交…
          {:else}
            {kind === 'signup' ? '注 册' : '重设密码并登录'}
          {/if}
        </button>
      {/if}
    </form>
  {/if}

  <p class="leaf-actions more">
    <a class="leaf-link" href="/login">{kind === 'signup' ? '已经有账号，去登录' : '想起来了，去登录'}</a>
  </p>
</div>

{#if kind === 'reset'}
  <p class="footnote">重设后，这个账号在其它设备上的登录会全部退出。</p>
{/if}

<style>
  .slot {
    min-block-size: 1.5rem;
    margin-block: calc(var(--space-2) * -1);
  }

  .more {
    margin-block-start: var(--space-4);
  }

  .code-card[data-status='success'] .leaf-btn[type='submit'] {
    background: var(--ribbon);
    border-color: var(--ribbon);
    opacity: 1;
  }

  .footnote {
    font: var(--text-xs) / 1.7 var(--label);
    color: var(--ink-3);
    text-align: center;
  }
</style>
