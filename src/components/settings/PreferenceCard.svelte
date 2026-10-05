<!--
  设置页的一栏偏好：标题、说明、表单字段（children）、保存 / 恢复默认，结果写在底部。
  保存、恢复默认都是 PATCH /api/settings/preferences 的一项；字段的值由父组件管着（它知道形状）
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { savePreferences } from '../../lib/settings-api';

  interface Props {
    /** Widget 类型，也是页面锚点（/settings#clock） */
    type: string;
    title: string;
    hint?: string;
    /** 要保存的值 */
    value: unknown;
    /** 存过（没在用默认值） */
    customized: boolean;
    /** 保存成功：服务端整理过的值；恢复默认时是 null */
    onsaved: (value: unknown) => void;
    children: Snippet;
    /** 放在表单前面的内容（比如 Steam 的账号绑定，自己有一个表单） */
    before?: Snippet;
  }

  let { type, title, hint, value, customized, onsaved, children, before }: Props = $props();

  let saving = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);

  async function save(next: unknown, done: string): Promise<void> {
    saving = true;
    notice = undefined;
    const result = await savePreferences({ [type]: next });
    saving = false;
    if (result.ok) {
      onsaved(result.data[type] ?? null);
      notice = { kind: 'ok', text: done };
    } else {
      notice = { kind: 'error', text: result.message };
    }
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void save($state.snapshot(value), '已保存，回主页就能看到');
  }
</script>

<section class="leaf-card" id={type} aria-labelledby="{type}-title">
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="{type}-title">{title}</h2>
    {#if customized}
      <span class="leaf-badge">已自定义</span>
    {:else}
      <span class="leaf-badge" data-kind="muted">默认</span>
    {/if}
  </div>
  {#if hint}<p class="leaf-card-hint">{hint}</p>{/if}

  {@render before?.()}

  <form class="leaf-form" onsubmit={onSubmit}>
    {@render children()}
    <div class="leaf-actions">
      <button type="submit" class="leaf-btn" data-kind="primary" disabled={saving}>保存</button>
      {#if customized}
        <button type="button" class="leaf-link" disabled={saving} onclick={() => save(null, '已恢复默认设置')}>恢复默认</button>
      {/if}
    </div>
  </form>

  {#if notice}<p class="leaf-notice" data-kind={notice.kind} role="status">{notice.text}</p>{/if}
</section>
