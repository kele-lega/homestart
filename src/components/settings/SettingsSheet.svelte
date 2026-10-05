<!--
  设置页：首页各版块的个人参数都在这里改，存在服务端、跟着账号走。没改过的一栏用 layout.yaml 里的默认值。
  每张卡片自己保存，互不影响；页面上没放的版块不出现
-->
<script lang="ts">
  import type { SyncSettings } from '../../adapters/calendar/google-sync';
  import type { CalendarSettings } from '../../adapters/calendar/model';
  import type { SteamBinding } from '../../adapters/steam/model';
  import type { PreferenceSections, Section } from '../../core/settings-view';
  import type { UserLinks } from '../../core/user-links';
  import CalendarCard from './CalendarCard.svelte';
  import ClockCard from './ClockCard.svelte';
  import DeadlineCard from './DeadlineCard.svelte';
  import LinksCard from './LinksCard.svelte';
  import SearchCard from './SearchCard.svelte';
  import SteamCard from './SteamCard.svelte';
  import WeatherCard from './WeatherCard.svelte';

  interface Props {
    /** 在设置页上显示的名字 */
    name: string;
    sections: PreferenceSections;
    /** 页面上有日历、今天或 Deadline 时才有 */
    calendar?: CalendarSettings;
    /** 页面上有日历时才有：自己添加的日程写回 Google 日历 */
    calendarSync?: SyncSettings;
    steam?: SteamBinding;
    /** 页面上有分类导航时才有 */
    links?: Section<UserLinks>;
    limits: { readonly deadline: { readonly max: number; readonly days: number }; readonly steamCount: number };
  }

  let { name, sections, calendar, calendarSync, steam, links, limits }: Props = $props();
  const empty = $derived(!Object.values(sections).some(Boolean) && !calendar && !links);
</script>

<div class="settings-head">
  <h1 class="settings-title">设置</h1>
  <p class="settings-hello">{name} 的个人设置，只对自己生效；没改过的用站点的默认值。</p>
</div>

{#if empty}
  <p class="leaf-notice">首页上没有可以设置的版块。</p>
{:else}
  <div class="settings-grid">
    {#if sections.weather}<WeatherCard section={sections.weather} />{/if}
    {#if sections.search}<SearchCard section={sections.search} />{/if}
    {#if sections.clock}<ClockCard section={sections.clock} />{/if}
    {#if calendar}<CalendarCard settings={calendar} sync={calendarSync} />{/if}
    {#if sections.deadline}<DeadlineCard section={sections.deadline} limits={limits.deadline} />{/if}
    {#if sections.steam && steam}<SteamCard section={sections.steam} binding={steam} maxCount={limits.steamCount} />{/if}
  </div>
  <!-- 导航内容多，单独占一整行 -->
  {#if links}<LinksCard section={links} />{/if}
{/if}

<style>
  .settings-head {
    padding-block-end: var(--space-3);
    border-block-end: 1px solid var(--ink);
  }

  .settings-title {
    font: 700 var(--text-2xl) / 1.3 var(--font-body);
    letter-spacing: 0.12em;
  }

  .settings-hello {
    margin-block-start: var(--space-1);
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr));
    gap: var(--space-6);
  }
</style>
