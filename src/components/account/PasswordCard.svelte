<!-- 改密码：要输入当前密码；成功后其它设备全部退出，这台保留 -->
<script lang="ts">
  import { tick } from 'svelte';
  import { changePassword } from '../../lib/auth-api';

  interface Props {
    /** 改好了：其它设备已经退出，设备列表该刷新了 */
    onchanged: () => void;
  }

  let { onchanged }: Props = $props();

  const MIN_LENGTH = 8;

  let saving = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string; readonly field?: 'current' | 'next' } | undefined>(
    undefined,
  );
  let currentInput = $state<HTMLInputElement>();
  let nextInput = $state<HTMLInputElement>();

  async function fail(text: string, field: 'current' | 'next'): Promise<void> {
    notice = { kind: 'error', text, field };
    await tick();
    (field === 'current' ? currentInput : nextInput)?.focus();
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const current = String(data.get('current') ?? '');
    const next = String(data.get('next') ?? '');
    // 两个都能在本地判断的错误先拦下，不必跑一趟服务端
    if (next.length < MIN_LENGTH) return fail(`新密码至少 ${MIN_LENGTH} 位`, 'next');
    if (next !== String(data.get('confirm') ?? '')) return fail('两次输入的新密码不一样', 'next');

    saving = true;
    notice = undefined;
    try {
      const result = await changePassword(current, next);
      saving = false;
      if (result.success && result.data) {
        form.reset();
        const others = result.data.signedOut;
        notice = { kind: 'ok', text: others > 0 ? `密码已更新，另外 ${others} 台设备已退出登录` : '密码已更新' };
        onchanged();
        await tick();
        currentInput?.focus();
        return;
      }
      const text = result.error ?? '修改失败，请稍后再试';
      return fail(text, text.includes('当前密码') ? 'current' : 'next');
    } catch {
      saving = false;
      return fail('网络出了点问题，没能修改', 'current');
    }
  }
</script>

<section class="leaf-card" aria-labelledby="password-title">
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="password-title">修改密码</h2>
    <span class="leaf-card-hint">改完后其它设备需要重新登录</span>
  </div>

  <form class="leaf-form" onsubmit={onSubmit}>
    <label class="leaf-field" data-invalid={notice?.field === 'current' ? '' : undefined}>
      <span class="leaf-field-label">当前密码</span>
      <input class="leaf-input" type="password" name="current" required autocomplete="current-password" bind:this={currentInput} />
    </label>
    <label class="leaf-field" data-invalid={notice?.field === 'next' ? '' : undefined}>
      <span class="leaf-field-label">新密码（至少 {MIN_LENGTH} 位）</span>
      <input class="leaf-input" type="password" name="next" required autocomplete="new-password" bind:this={nextInput} />
    </label>
    <label class="leaf-field" data-invalid={notice?.field === 'next' ? '' : undefined}>
      <span class="leaf-field-label">再输一遍新密码</span>
      <input class="leaf-input" type="password" name="confirm" required autocomplete="new-password" />
    </label>
    <div class="leaf-actions">
      <button type="submit" class="leaf-btn" data-kind="primary" disabled={saving}>{saving ? '正在保存…' : '更新密码'}</button>
    </div>
    {#if notice}
      <p class="leaf-notice" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
    {/if}
  </form>
</section>
