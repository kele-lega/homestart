<!--
  登录页的表单卡片。用 fetch 登录：错了卡片轻轻一晃、红笔批一句、密码清空重来；
  对了按钮上写「欢迎回来」，稍停一下再跳回首页（首页翻回来盖上、书签落下，见 styles/page-turn.css、zones/Bookmark.astro）。
  脚本接管之前按钮是灰的：原生提交经反代会被 Astro 的 checkOrigin 拦下（403），不如不让它发生；
  method="post" 只是兜底，万一被提交，密码也只在请求体里、不会出现在地址栏
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { login } from '../lib/auth-api';
  import { SIGNED_IN_FLAG } from '../lib/page-turn';

  /** 「欢迎回来」停留多久再翻页：够看清，又不拖 */
  const WELCOME_PAUSE_MS = 480;

  let hydrated = $state(false);
  let shaking = $state(false);
  let status = $state<'idle' | 'pending' | 'success'>('idle');
  let error = $state<string | undefined>(undefined);
  let welcome = $state('');
  let card = $state<HTMLDivElement>();
  let usernameInput = $state<HTMLInputElement>();
  let passwordInput = $state<HTMLInputElement>();

  onMount(() => {
    hydrated = true;
    // 密码管理器可能已经填好了用户名
    (usernameInput?.value ? passwordInput : usernameInput)?.focus();
  });

  /** 先摘掉 class、等它真的从 DOM 上消失再加回：同一个动画才能再播一遍 */
  async function shake(): Promise<void> {
    shaking = false;
    await tick();
    void card?.offsetWidth;
    shaking = true;
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (status !== 'idle') return;
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const username = String(data.get('username') ?? '');
    const password = String(data.get('password') ?? '');
    status = 'pending';
    error = undefined;
    try {
      const result = await login(username, password, data.get('remember') === 'on');
      if (result.success && result.data) {
        welcome = `欢迎回来，${result.data.displayName ?? result.data.username}`;
        status = 'success';
        try {
          sessionStorage.setItem(SIGNED_IN_FLAG, '1');
        } catch {
          // 存储不可用：首页只是少了书签落下的那一下
        }
        setTimeout(() => location.replace('/'), WELCOME_PAUSE_MS);
        return;
      }
      error = result.error ?? '登录失败，请稍后再试';
    } catch {
      error = '网络出了点问题，请稍后再试';
    }
    status = 'idle';
    void shake();
    // 提交时按钮 disabled 会把焦点踢到 body：还给密码框，清空重填
    await tick();
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.focus();
    }
  }
</script>

<div class="leaf-card login-card" class:shake={shaking} bind:this={card} data-status={status}>
  <div class="leaf-card-head">
    <h1 class="leaf-card-title">登录</h1>
    <span class="leaf-card-hint">账号由管理员开通</span>
  </div>

  <form class="leaf-form" method="post" onsubmit={onSubmit}>
    <label class="leaf-field">
      <span class="leaf-field-label">用户名</span>
      <input
        class="leaf-input"
        type="text"
        name="username"
        required
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        bind:this={usernameInput}
      />
    </label>
    <label class="leaf-field" data-invalid={error ? '' : undefined}>
      <span class="leaf-field-label">密码</span>
      <input
        class="leaf-input"
        type="password"
        name="password"
        required
        autocomplete="current-password"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'login-error' : undefined}
        bind:this={passwordInput}
      />
    </label>
    <label class="leaf-check">
      <input type="checkbox" name="remember" />
      记住我（30 天内免登录）
    </label>

    <p class="error-slot" aria-live="polite">
      {#if error}
        <span class="leaf-notice error" data-kind="error" id="login-error">{error}</span>
      {/if}
    </p>

    <button type="submit" class="leaf-btn submit" data-kind="wide" disabled={!hydrated || status !== 'idle'}>
      <span class="submit-label">
        {#if status === 'success'}
          {welcome}
        {:else if status === 'pending'}
          正在核对…
        {:else}
          登 录
        {/if}
      </span>
    </button>
  </form>
</div>

<p class="footnote">不登录也能用主页的全部基础功能；登录后，日历订阅和 Steam 绑定跟着你的账号走。</p>

<style>
  .login-card.shake {
    animation: shake 420ms var(--ease-out);
  }

  @keyframes shake {
    0%,
    100% {
      translate: 0;
    }

    20% {
      translate: -7px 0;
    }

    40% {
      translate: 6px 0;
    }

    60% {
      translate: -4px 0;
    }

    80% {
      translate: 2px 0;
    }
  }

  /* 错误提示占住一行的高度，出现、消失时下面的按钮不跳 */
  .error-slot {
    min-block-size: 1.5rem;
    margin-block: calc(var(--space-2) * -1);
  }

  .error {
    display: inline-block;
    animation: annotate var(--dur-open) var(--ease-out) both;
  }

  /* 红笔批注：从左往右写出来 */
  @keyframes annotate {
    from {
      opacity: 0;
      clip-path: inset(0 100% 0 0);
      translate: -4px 0;
    }

    to {
      opacity: 1;
      clip-path: inset(0);
      translate: 0;
    }
  }

  .submit {
    overflow: hidden;
  }

  /* 核对中：一道樱色的光从按钮上扫过 */
  .login-card[data-status='pending'] .submit::after {
    position: absolute;
    inset: 0;
    content: '';
    background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--sakura) 45%, transparent) 50%, transparent 70%);
    animation: sweep 1.1s var(--ease-in-out) infinite;
  }

  @keyframes sweep {
    from {
      translate: -100% 0;
    }

    to {
      translate: 100% 0;
    }
  }

  .login-card[data-status='success'] .submit {
    background: var(--ribbon);
    border-color: var(--ribbon);
    opacity: 1;
    transition: background-color var(--dur-open) var(--ease-out);
  }

  .submit-label {
    display: inline-block;
  }

  .login-card[data-status='success'] .submit-label {
    animation: welcome var(--dur-open) var(--spring) both;
  }

  @keyframes welcome {
    from {
      opacity: 0;
      translate: 0 0.5rem;
    }

    to {
      opacity: 1;
      translate: 0;
    }
  }

  .footnote {
    font: var(--text-xs) / 1.7 var(--label);
    color: var(--ink-3);
    text-align: center;
  }
</style>
