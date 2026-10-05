<!-- 搜索：用哪个引擎（只能在 layout.yaml 列出的几个里选）、要不要联想、要不要同时搜收录的网站 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Section } from '../../core/settings-view';
  import { ENGINES, type EngineId } from '../../widgets/search/engines';
  import type { SearchPreference } from '../../widgets/search/widget';
  import { Editable } from './editable.svelte';
  import PreferenceCard from './PreferenceCard.svelte';

  interface Props {
    section: Section<SearchPreference> & { readonly engines: readonly EngineId[] };
  }

  let { section }: Props = $props();
  const pref = new Editable(untrack(() => section));
</script>

<PreferenceCard type="search" title="搜索" value={pref.value} customized={!!pref.saved} onsaved={pref.onsaved}>
  <fieldset class="choices">
    <legend class="leaf-field-label">搜索引擎</legend>
    {#each section.engines as engine (engine)}
      <label class="leaf-check">
        <input type="radio" name="engine" value={engine} bind:group={pref.value.engine} />
        {ENGINES[engine].name}
      </label>
    {/each}
  </fieldset>
  <label class="leaf-check">
    <input type="checkbox" name="suggest" bind:checked={pref.value.suggest} />
    输入时显示联想词
  </label>
  <label class="leaf-check">
    <input type="checkbox" name="sites" bind:checked={pref.value.sites} />
    同时搜索收录的网站
  </label>
</PreferenceCard>

<style>
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .choices legend {
    inline-size: 100%;
    margin-block-end: var(--space-2);
    padding: 0;
  }
</style>
