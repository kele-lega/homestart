<!-- 时钟：显不显示秒；时间旁那两行日期显示哪几段 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Section } from '../../core/settings-view';
  import type { ClockPreference } from '../../widgets/clock/widget';
  import { Editable } from './editable.svelte';
  import PreferenceCard from './PreferenceCard.svelte';

  interface Props {
    section: Section<ClockPreference>;
  }

  let { section }: Props = $props();
  const pref = new Editable(untrack(() => section));
</script>

<PreferenceCard type="clock" title="时钟" value={pref.value} customized={!!pref.saved} onsaved={pref.onsaved}>
  <label class="leaf-check">
    <input type="checkbox" name="seconds" bind:checked={pref.value.seconds} />
    显示秒
  </label>
  <fieldset class="parts">
    <legend class="leaf-field-label">时间旁边显示</legend>
    <label class="leaf-check">
      <input type="checkbox" name="date" bind:checked={pref.value.date} />
      日期（2026.10.01）
    </label>
    <label class="leaf-check">
      <input type="checkbox" name="weekday" bind:checked={pref.value.weekday} />
      星期（周四）
    </label>
    <label class="leaf-check">
      <input type="checkbox" name="lunar" bind:checked={pref.value.lunar} />
      农历（八月廿一）
    </label>
    <label class="leaf-check">
      <input type="checkbox" name="festival" bind:checked={pref.value.festival} />
      节日和节气（国庆、秋分）
    </label>
  </fieldset>
</PreferenceCard>

<style>
  /* 四个勾选框排成一行，放不下再折行 */
  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .parts legend {
    inline-size: 100%;
    margin-block-end: var(--space-2);
    padding: 0;
  }
</style>
