<!--
  设置页：首页各版块的个人参数都在这里改，存在服务端、跟着账号走。没改过的一栏用 layout.yaml 里的默认值。
  页面上只摆几格器物（ScrollShelf），一格是一卷：首页、导航、日历、游艺；点开是一幅挂轴，这一卷的卡片都在轴里，
  每张自己保存、互不影响。页面上没放的版块不出现，一卷里一项都没有时整格不出现。
  /settings#steam 这样的地址（卡片的 id，或卷名 #home）打开时直接展开那一卷、滚到那张卡片
-->
<script lang="ts">
  import type { SyncSettings } from '../../adapters/calendar/google-sync';
  import type { CalendarSettings } from '../../adapters/calendar/model';
  import type { SteamBinding } from '../../adapters/steam/model';
  import type { PreferenceSections, Section } from '../../core/settings-view';
  import type { UserLinks } from '../../core/user-links';
  import ScrollShelf from '../ScrollShelf.svelte';
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

  const present = <T,>(item: T | false | null | undefined): item is T => !!item;

  /** 每一卷：格子上的名字、里面有哪几项（卡片 id 和名字），只留页面上真有的 */
  const juans = $derived(
    (
      [
        {
          id: 'home',
          name: '首页',
          cards: [
            sections.weather && (['weather', '天气'] as const),
            sections.search && (['search', '搜索'] as const),
            sections.clock && (['clock', '时钟'] as const),
            sections.deadline && (['deadline', 'Deadline'] as const),
          ],
        },
        { id: 'nav', name: '导航', cards: [links && (['links', '分类与网站'] as const)] },
        {
          id: 'cal',
          name: '日历',
          cards: [calendar && (['calendar', '日历订阅'] as const), calendar && calendarSync && (['calendar-sync', '写回 Google'] as const)],
        },
        { id: 'play', name: '游艺', cards: [sections.steam && steam && (['steam', 'Steam'] as const)] },
      ] as const
    )
      .map((juan) => ({ ...juan, cards: juan.cards.filter(present) }))
      .filter((juan) => juan.cards.length > 0),
  );
</script>

<div class="settings-head">
  <h1 class="settings-title">设置</h1>
  <p class="settings-hello">{name} 的个人设置，只对自己生效；没改过的用站点的默认值。</p>
</div>

{#if juans.length === 0}
  <p class="leaf-notice">首页上没有可以设置的版块。</p>
{:else}
  <ScrollShelf {juans}>
    {#snippet icon(id: string)}
      {#if id === 'home'}
        <!-- 月洞门：一堵粉墙、一道瓦檐，墙上开一扇圆门，门上一方朱砂匾 -->
        <path d="M4 11.6 Q20 8.4 36 11.6" />
        <path d="M6.4 11.4 V36 M33.6 11.4 V36 M3.6 36 H36.4" />
        <circle cx="20" cy="25.4" r="8.8" />
        <path class="faint" d="M13.4 30.6 C16 29.2 18.6 30 20.6 28.8 C23 27.6 24.6 28.6 26.8 28" />
        <rect class="dan" x="16.6" y="13" width="6.8" height="2.8" rx=".4" />
      {:else if id === 'nav'}
        <!-- 一编竹简：首页「目录」的那件器物 -->
        {#each [7.4, 11.6, 15.8, 20, 24.2, 28.4] as x, i (x)}
          <rect x={x} y={8 + (i % 2) * 0.8} width="2.6" height={23.4 - (i % 3) * 0.6} rx=".5" />
        {/each}
        <path
          class="faint"
          d="M4.6 13.6 C10 12.6 18 14.6 26 13.4 C30 12.8 32.6 13 35 13.8 M4.6 27.4 C10 26.4 18 28.6 26 27.4 C30 26.8 32.6 27 35 27.8"
        />
        <path d="M4.6 13.6 L4.2 19.6" />
        <rect class="dan" x="2.4" y="19.4" width="3.8" height="6.4" rx=".6" />
      {:else if id === 'cal'}
        <!-- 日晷：首页「月令」的那件器物 -->
        <path d="M11 37.4 H29 L27 31.4 H13 Z" />
        <path d="M20 31.4 V24.4" />
        <g transform="rotate(-22 20 16) scale(1 .62) translate(0 9.8)">
          <circle cx="20" cy="16" r="12.4" />
          <circle cx="20" cy="16" r="9" class="faint" />
        </g>
        <path d="M17.2 22.4 L24.6 4.6" />
        <circle class="dan" cx="20.2" cy="15.6" r="1.6" />
      {:else}
        <!-- 风筝：首页「游艺」的那件器物 -->
        <path class="faint" d="M20 15.4 C14 22 8 30 3 38.6" />
        <path d="M20 4.6 L29.4 15 L20 27 L10.6 15 Z" />
        <path class="faint" d="M20 4.6 V27 M10.6 15 Q20 12.4 29.4 15" />
        <path d="M20 27 C18 29.6 22 31.6 20 34.4 C18.2 36.8 21 38.4 19.6 39.6" />
        <path class="dan" d="M18.2 30.2 L20 31.2 L21.8 30.2 L21.8 32.4 L20 31.4 L18.2 32.4 Z" />
      {/if}
    {/snippet}
    {#snippet content(id: string)}
      {#if id === 'home'}
        {#if sections.weather}<WeatherCard section={sections.weather} />{/if}
        {#if sections.search}<SearchCard section={sections.search} />{/if}
        {#if sections.clock}<ClockCard section={sections.clock} />{/if}
        {#if sections.deadline}<DeadlineCard section={sections.deadline} limits={limits.deadline} />{/if}
      {:else if id === 'nav'}
        {#if links}<LinksCard section={links} />{/if}
      {:else if id === 'cal'}
        {#if calendar}<CalendarCard settings={calendar} sync={calendarSync} />{/if}
      {:else if sections.steam && steam}
        <SteamCard section={sections.steam} binding={steam} maxCount={limits.steamCount} />
      {/if}
    {/snippet}
  </ScrollShelf>
{/if}

<style>
  .settings-head {
    display: grid;
    justify-items: center;
    gap: 0.6rem;
    margin-block: 1rem 3.2rem;
    text-align: center;
  }

  .settings-title {
    margin-inline-end: -0.8em;
    font: 400 2.4rem / 1.2 var(--brush);
    letter-spacing: 0.8em;
  }

  .settings-hello {
    font: 0.85rem / 1.6 var(--song);
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }
</style>
