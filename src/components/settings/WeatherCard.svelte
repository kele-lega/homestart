<!--
  天气地区：输入地名搜索（OpenStreetMap + Open-Meteo 地名搜索，经 /api/settings/places 转发），点一个候选地点就保存。
  地名连同坐标一起存，页头天气上方显示的就是这个地名
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { Place } from '../../adapters/geocoding';
  import type { Section } from '../../core/settings-view';
  import { savePreferences, searchPlaces } from '../../lib/settings-api';
  import type { WeatherPreference } from '../../widgets/weather/widget';

  interface Props {
    section: Section<WeatherPreference>;
  }

  let { section }: Props = $props();

  // 服务端给的只是初始值，之后以接口返回为准
  let saved = $state(untrack(() => section.saved));
  const current = $derived(saved ?? section.defaults);

  let query = $state('');
  let places = $state<readonly Place[] | undefined>(undefined);
  let busy = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);
  let input = $state<HTMLInputElement>();

  async function onSearch(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    notice = undefined;
    const result = await searchPlaces(query);
    busy = false;
    if (result.ok) {
      places = result.data;
    } else {
      places = undefined;
      notice = { kind: 'error', text: result.message };
    }
  }

  async function save(next: WeatherPreference | null, done: string): Promise<void> {
    busy = true;
    notice = undefined;
    const result = await savePreferences({ weather: next });
    busy = false;
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      return;
    }
    saved = (result.data.weather ?? undefined) as WeatherPreference | undefined;
    places = undefined;
    query = '';
    notice = { kind: 'ok', text: done };
    // 候选列表收起来了，焦点放回输入框
    await tick();
    input?.focus();
  }

  function choose(place: Place): void {
    const { name: label, latitude, longitude } = place;
    void save({ label, latitude, longitude }, `已换成 ${label}，回主页就能看到`);
  }

  const coords = (point: { latitude: number; longitude: number }) =>
    `${point.latitude.toFixed(2)}, ${point.longitude.toFixed(2)}`;
</script>

<section class="leaf-card" id="weather" aria-labelledby="weather-title">
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="weather-title">天气地区</h2>
    {#if saved}
      <span class="leaf-badge">已自定义</span>
    {:else}
      <span class="leaf-badge" data-kind="muted">默认</span>
    {/if}
  </div>

  <p class="place">
    <span class="place-name">{current.label || '未命名的地点'}</span>
    <span class="leaf-meta">{coords(current)}</span>
  </p>

  <form class="leaf-form" role="search" aria-label="搜索地点" onsubmit={onSearch}>
    <label class="leaf-field">
      <span class="leaf-field-label">换一个地方：输入城市或区县名</span>
      <input
        class="leaf-input"
        name="place"
        required
        maxlength="60"
        autocomplete="off"
        placeholder="坪山、杭州、Tokyo…"
        bind:value={query}
        bind:this={input}
      />
    </label>
    <div class="leaf-actions">
      <button type="submit" class="leaf-btn" disabled={busy}>搜索</button>
      {#if saved}
        <button type="button" class="leaf-link" disabled={busy} onclick={() => save(null, '已恢复默认地区')}>
          恢复默认（{section.defaults.label || coords(section.defaults)}）
        </button>
      {/if}
    </div>
  </form>

  {#if places}
    {#if places.length > 0}
      <ul class="places" role="list" aria-label="搜索结果">
        {#each places as place (`${place.latitude},${place.longitude}`)}
          <li>
            <button type="button" class="place-option" disabled={busy} onclick={() => choose(place)}>
              <span class="place-name">{place.name}</span>
              <span class="leaf-meta">{place.region}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="leaf-notice" role="status">没有找到「{query}」，换个写法试试</p>
    {/if}
  {/if}

  {#if notice}<p class="leaf-notice" data-kind={notice.kind} role="status">{notice.text}</p>{/if}
</section>

<style>
  .place {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }

  .place-name {
    font-size: var(--text-lg);
    font-weight: 700;
  }

  .places {
    display: grid;
    padding: 0;
    list-style: none;
    border-block-start: var(--rule-thin);
  }

  .places li {
    border-block-end: var(--rule-thin);
  }

  /* 整行都能点：地名在左，上级区划在右 */
  .place-option {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    inline-size: 100%;
    padding: var(--space-2) var(--space-1);
    text-align: start;
    background: none;
    border: 0;
  }

  .place-option .place-name {
    font-size: var(--text-base);
  }

  @media (hover: hover) {
    .place-option:not(:disabled):hover {
      background: var(--sakura-wash);
    }
  }
</style>
