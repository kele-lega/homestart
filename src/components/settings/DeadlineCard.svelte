<!-- Deadline：最多列几条、往后看多少天 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Section } from '../../core/settings-view';
  import type { DeadlinePreference } from '../../widgets/deadline/widget';
  import { Editable } from './editable.svelte';
  import PreferenceCard from './PreferenceCard.svelte';

  interface Props {
    section: Section<DeadlinePreference>;
    /** 服务端的上限（DEADLINE_LIMITS），widget.ts 不能进浏览器，由页面传进来 */
    limits: { readonly max: number; readonly days: number };
  }

  let { section, limits }: Props = $props();
  const pref = new Editable(untrack(() => section));
</script>

<PreferenceCard type="deadline" title="Deadline" value={pref.value} customized={!!pref.saved} onsaved={pref.onsaved}>
  <div class="pair">
    <label class="leaf-field">
      <span class="leaf-field-label">最多列几条（1–{limits.max}）</span>
      <input class="leaf-input" type="number" name="max" required min="1" max={limits.max} step="1" bind:value={pref.value.max} />
    </label>
    <label class="leaf-field">
      <span class="leaf-field-label">往后看多少天（1–{limits.days}）</span>
      <input class="leaf-input" type="number" name="days" required min="1" max={limits.days} step="1" bind:value={pref.value.days} />
    </label>
  </div>
</PreferenceCard>

<style>
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-4);
  }
</style>
