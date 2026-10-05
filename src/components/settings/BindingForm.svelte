<!--
  只提交、不回显的一项绑定（日历订阅地址、Steam 账号）：上面一行说现在的状态，
  点「修改」展开输入框，保存或删除后收起。输入的内容不回显：订阅地址本身就是访问日历的凭据
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { isComposing } from '../../lib/keyboard';
  import type { SettingsResult } from '../../lib/settings-api';

  interface Props {
    /** 输入框 id 的前缀 */
    id: string;
    /** 「订阅：calendar.google.com」「还没有订阅」 */
    status: string;
    bound: boolean;
    label: string;
    placeholder: string;
    hint: string;
    inputType?: 'text' | 'url';
    /** 「添加订阅」「绑定账号」 */
    addLabel: string;
    removeLabel: string;
    save: (value: string) => Promise<SettingsResult<unknown>>;
    remove: () => Promise<SettingsResult<unknown>>;
    /** 保存、删除成功后：父组件更新状态，返回给用户看的一句话 */
    ondone: (data: unknown) => string;
  }

  let { id, status, bound, label, placeholder, hint, inputType = 'text', addLabel, removeLabel, save, remove, ondone }: Props =
    $props();

  let editing = $state(false);
  let busy = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string; readonly invalid?: boolean } | undefined>(
    undefined,
  );
  let input = $state<HTMLInputElement>();
  let toggle = $state<HTMLButtonElement>();

  async function open(): Promise<void> {
    editing = true;
    notice = undefined;
    await tick();
    input?.focus();
  }

  async function close(): Promise<void> {
    editing = false;
    await tick();
    toggle?.focus();
  }

  async function run(task: () => Promise<SettingsResult<unknown>>, invalidOnError: boolean): Promise<void> {
    busy = true;
    notice = undefined;
    const result = await task();
    busy = false;
    if (result.ok) {
      notice = { kind: 'ok', text: ondone(result.data) };
      await close();
      return;
    }
    notice = { kind: 'error', text: result.message, invalid: invalidOnError };
    // 保存期间按钮是禁用的，焦点已经丢了：放回输入框，读屏从说明里念出失败原因
    await tick();
    input?.focus();
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void run(() => save(input?.value ?? ''), true);
  }

  /** 焦点在表单里任何地方（输入框、按钮）按 Esc 都收起 */
  function closeOnEscape(form: HTMLFormElement): () => void {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isComposing(event) || event.defaultPrevented) return;
      event.preventDefault();
      void close();
    };
    form.addEventListener('keydown', onKey);
    return () => form.removeEventListener('keydown', onKey);
  }
</script>

<div class="binding">
  <p class="binding-status">
    <span>{status}</span>
    {#if !editing}
      <button type="button" class="leaf-link" bind:this={toggle} onclick={open}>{bound ? '修改' : addLabel}</button>
    {/if}
  </p>

  {#if editing}
    <form class="leaf-form" onsubmit={onSubmit} {@attach closeOnEscape}>
      <label class="leaf-field" data-invalid={notice?.invalid ? '' : undefined}>
        <span class="leaf-field-label">{label}</span>
        <input
          class="leaf-input"
          type={inputType}
          name="value"
          required
          autocomplete="off"
          spellcheck="false"
          {placeholder}
          aria-invalid={notice?.invalid === true}
          aria-describedby="{id}-hint"
          bind:this={input}
        />
      </label>
      <p class="leaf-card-hint" id="{id}-hint">{hint}</p>
      <div class="leaf-actions">
        <button type="submit" class="leaf-btn" data-kind="primary" disabled={busy}>保存</button>
        {#if bound}
          <button type="button" class="leaf-link" data-kind="danger" disabled={busy} onclick={() => run(remove, false)}>
            {removeLabel}
          </button>
        {/if}
        <button type="button" class="leaf-link" disabled={busy} onclick={close}>取消</button>
      </div>
    </form>
  {/if}

  {#if notice}<p class="leaf-notice" data-kind={notice.kind} role="status">{notice.text}</p>{/if}
</div>

<style>
  .binding {
    display: grid;
    gap: var(--space-3);
  }

  .binding-status {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    overflow-wrap: anywhere;
  }
</style>
