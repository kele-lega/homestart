<script lang="ts">
  /**
   * 月历：服务端先画好本月的格子（农历、节日节气、法定节假日都在服务端算），挂载后再取这几周的日程；
   * 翻页经 month 操作取那个月的格子和日程。点一天，在下面列出当天的日程。ICS 订阅在设置页里填。
   * 登录后能自己添加日程（EventDialog），点自己添加的那件可以修改、删除；订阅里的只能看。
   * 连了 Google 日历时，还没推过去的标「未同步」，底部能重试
   */
  import { onMount, tick } from 'svelte';
  import type { WidgetHeading } from '../../core/widget';
  import { feedNotice } from '../../lib/feed-view';
  import { fetchAction, sendAction } from '../../lib/widget-api';
  import { cacheable, moveInGrid, pageDelta, readMonth } from './client';
  import type { MonthData } from './data';
  import EventDialog from './EventDialog.svelte';
  import type { DayCell, MonthGrid } from './month';
  import {
    formatMonthKey,
    inRange,
    monthCaption,
    monthOfDate,
    sameMonth,
    shiftMonth,
    WEEKDAY_HEADS,
    type MonthKey,
  } from './month-key';

  interface Props {
    id: string;
    /** 栏目头；实例把标题设成空时没有 */
    heading: WidgetHeading | undefined;
    /** 服务端画好的本月格子 */
    initial: MonthGrid;
    /** 站点时区的今天 'YYYY-MM-DD' */
    today: string;
    /** 站点时区：新建日程默认从下一个整点开始 */
    timeZone: string;
  }

  let { id, heading, initial, today, timeZone }: Props = $props();
  let editor = $state<EventDialog>();

  // 翻过的月份留在内存里，来回翻不重复请求；日程可能有变，几分钟后作废
  const CACHE_MS = 5 * 60_000;
  const cache = new Map<string, { readonly data: MonthData; readonly at: number }>();
  let controller: AbortController | undefined;

  /** 正在显示的月份的数据；挂载后第一次取回之前没有，只显示服务端画好的格子 */
  let shown = $state.raw<MonthData | undefined>(undefined);
  /** 正在请求的月份 */
  let wanted = $state.raw<MonthKey | undefined>(undefined);
  /** 上一次没取回来的月份：底部提示，可以重试 */
  let failedKey = $state.raw<MonthKey | undefined>(undefined);
  let selected = $state<string | undefined>(undefined);
  /** 键盘焦点所在的日子；格子里只有这一格能用 Tab 进入 */
  let focusDate = $state<string | undefined>(undefined);
  let pending = $state(false);
  let gridEl = $state<HTMLElement | undefined>(undefined);

  const grid = $derived(shown?.grid ?? initial);
  const shownKey = $derived<MonthKey>({ year: grid.year, month: grid.month });
  // 连续翻页时从正在请求的月份接着翻，标题立刻跟上，格子等数据到了再换
  const baseKey = $derived(wanted ?? shownKey);
  const caption = $derived(monthCaption(baseKey));
  const todayKey = $derived(monthOfDate(today));
  const onTodayMonth = $derived(sameMonth(baseKey, todayKey));
  const canPrev = $derived(inRange(shiftMonth(baseKey, -1)));
  const canNext = $derived(inRange(shiftMonth(baseKey, 1)));

  const feed = $derived(shown?.feed);
  const byDay = $derived(feed?.status === 'ok' ? feed.data : {});
  const notice = $derived(feed && feedNotice(feed));
  /** 自己添加的日程；没登录时没有，也就不能新建 */
  const own = $derived(shown?.own);
  /** 连了 Google 日历时还没推过去的件数 */
  const unsyncedCount = $derived(shown?.pending ?? 0);
  let syncing = $state(false);

  const selectedCell = $derived(grid.cells.find((cell) => cell.date === selected));
  const selectedEntries = $derived(selected ? (byDay[selected] ?? []) : []);
  // 格子里能用 Tab 进入的那一格：键盘停过的、选中的、今天，都不在这页时取第一格
  const tabDate = $derived.by(() => {
    const dates = new Set(grid.cells.map((cell) => cell.date));
    const candidates = [focusDate, selected, today].filter((date) => date !== undefined && dates.has(date));
    return candidates[0] ?? grid.cells[0]?.date;
  });

  function show(data: MonthData): void {
    // 换了月份才清掉选中；同一个月重新取回（重试、首次加载）时保留
    if (data.grid.key !== grid.key) selected = undefined;
    shown = data;
  }

  /** 取某个月的格子和日程；新的请求会取消还没回来的旧请求 */
  async function request(key: MonthKey): Promise<void> {
    const cacheKey = formatMonthKey(key);
    controller?.abort();
    failedKey = undefined;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      controller = undefined;
      wanted = undefined;
      pending = false;
      show(hit.data);
      return;
    }
    const current = new AbortController();
    controller = current;
    wanted = key;
    pending = true;
    try {
      const data = readMonth(await fetchAction(id, 'month', { month: cacheKey }, current.signal));
      if (current.signal.aborted) return;
      if (data) {
        if (cacheable(data)) cache.set(cacheKey, { data, at: Date.now() });
        show(data);
      } else {
        failedKey = key;
      }
    } catch {
      // 被新请求取消的不算失败；其余（断网、服务端出错）在底部提示，可以重试
      if (!current.signal.aborted) failedKey = key;
    } finally {
      if (controller === current) {
        controller = undefined;
        wanted = undefined;
        pending = false;
      }
    }
  }

  /** 翻到的月份里键盘焦点落在哪一天：本月落在今天，其它月份落在 1 号 */
  function landingDate(key: MonthKey): string {
    return sameMonth(key, todayKey) ? today : `${formatMonthKey(key)}-01`;
  }

  async function focusCell(date: string): Promise<void> {
    focusDate = date;
    await tick();
    gridEl?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  }

  async function go(delta: number, refocus = false): Promise<void> {
    const key = shiftMonth(baseKey, delta);
    if (!inRange(key)) return;
    await request(key);
    if (refocus && sameMonth(shownKey, key)) await focusCell(landingDate(key));
  }

  let todayButton = $state<HTMLButtonElement | undefined>(undefined);

  /** 「回到本月」点完按钮就不见了：焦点交给今天那一格；没取回来时按钮又出现，焦点回到按钮上 */
  async function toToday(): Promise<void> {
    await request(todayKey);
    if (sameMonth(shownKey, todayKey)) {
      await focusCell(today);
    } else if (failedKey && sameMonth(failedKey, todayKey)) {
      await tick();
      todayButton?.focus();
    }
  }

  function toggle(date: string): void {
    selected = selected === date ? undefined : date;
    focusDate = date;
  }

  function onCellKey(event: KeyboardEvent, index: number): void {
    const delta = pageDelta(event.key);
    if (delta) {
      event.preventDefault();
      // 按住不放时系统连发的按键不翻页：一口气翻出十几个月的请求会用完限流的额度
      if (!event.repeat) void go(delta, true);
      return;
    }
    const target = moveInGrid(event.key, index, grid.cells.length);
    if (target === undefined) return;
    event.preventDefault();
    void focusCell(grid.cells[target]!.date);
  }

  /** 读屏念的：日期说明、今天、有几件日程 */
  function cellLabel(cell: DayCell): string {
    const count = byDay[cell.date]?.length ?? 0;
    const [date, ...rest] = cell.description.split('，');
    return [date, ...(cell.today ? ['今天'] : []), ...rest, ...(count > 0 ? [`${count} 件日程`] : [])].join('，');
  }

  onMount(() => {
    void request(shownKey);
    return () => controller?.abort();
  });

  /** 新建、修改、删除以后：日程可能跨月，翻过的月份全部作废，重取正在显示的这个月 */
  function reload(): void {
    cache.clear();
    void request(shownKey);
  }

  /** 新建：选中了哪天就在哪天，否则今天（不在这页时是这个月 1 号） */
  function createEvent(): void {
    const onPage = (date: string) => grid.cells.some((cell) => cell.date === date && !cell.outside);
    const date = selected ?? (onPage(today) ? today : `${formatMonthKey(shownKey)}-01`);
    void editor?.create(date);
  }

  async function retrySync(): Promise<void> {
    syncing = true;
    try {
      await sendAction(id, 'sync', { method: 'POST' });
    } catch {
      // 结果看重取回来的 pending
    }
    syncing = false;
    reload();
  }

  function retry(): void {
    // 翻页没取到的重取那个月；订阅读取失败的重取正在显示的月份
    void request(failedKey ?? shownKey);
  }
</script>

<div class="calendar">
  {#if heading}
    <div class="l-frame-head">
      <svelte:element this={`h${heading.level}`} class="l-frame-title">{heading.title}</svelte:element>
    </div>
  {/if}

  <div class="cal-month">
    <span class="m" aria-hidden="true">{String(baseKey.month).padStart(2, '0')}</span>
    <span class="y" aria-hidden="true">{caption.year}<br />{caption.detail}</span>
    <span class="visually-hidden" aria-live="polite">{baseKey.year}年{baseKey.month}月</span>
    <div class="cal-nav">
      {#if own}
        <button type="button" class="cal-today cal-new" onclick={createEvent}>+ 新建</button>
      {/if}
      {#if !onTodayMonth}
        <button type="button" class="cal-today" bind:this={todayButton} onclick={toToday}>回到本月</button>
      {/if}
      <button type="button" class="cal-step" aria-label="上个月" disabled={!canPrev} onclick={() => go(-1)}>‹</button>
      <button type="button" class="cal-step" aria-label="下个月" disabled={!canNext} onclick={() => go(1)}>›</button>
    </div>
  </div>

  <div class="cal-grid" role="group" aria-label="{grid.year}年{grid.month}月" aria-busy={pending} bind:this={gridEl}>
    {#each WEEKDAY_HEADS as head}
      <span class="wd" aria-hidden="true">{head}</span>
    {/each}
    {#each grid.cells as cell, index (cell.date)}
      <button
        type="button"
        class="cell"
        class:out={cell.outside}
        class:today={cell.today}
        class:rest={cell.rest}
        class:fest={cell.accent}
        data-date={cell.date}
        tabindex={cell.date === tabDate ? 0 : -1}
        aria-pressed={cell.date === selected}
        aria-label={cellLabel(cell)}
        onclick={() => toggle(cell.date)}
        onkeydown={(event) => onCellKey(event, index)}
        onfocus={() => (focusDate = cell.date)}
      >
        <span class="wash"></span>
        <b>{cell.day}</b>
        <i>{cell.label}</i>
        {#if cell.badge}<span class="badge" data-kind={cell.badge === '班' ? 'work' : 'rest'}>{cell.badge}</span>{/if}
        {#if byDay[cell.date]?.length}<span class="due"></span>{/if}
      </button>
    {/each}
  </div>

  <!-- 点一天，下面列出那天的日程；读屏在选中时念出来 -->
  <div aria-live="polite">
    {#if selectedCell}
      <div class="cal-day">
        <p class="cal-day-head">{selectedCell.description}</p>
        {#if selectedEntries.length > 0}
          <ol class="cal-entries" role="list">
            {#each selectedEntries as entry}
              {@const meta = [entry.until && `至 ${entry.until}`, entry.location].filter(Boolean).join(' · ')}
              <li class="entry">
                <span class="entry-time">
                  {#if entry.until}
                    <span aria-hidden="true">{entry.time}</span><span class="visually-hidden">接前一天</span>
                  {:else}
                    {entry.time}
                  {/if}
                </span>
                {#if own?.[entry.id]}
                  {@const mine = own[entry.id]!}
                  <button type="button" class="entry-name entry-edit" aria-label="修改 {entry.title}" onclick={() => editor?.edit(entry.id, mine.fields)}>
                    {entry.title}{#if mine.unsynced}<span class="entry-tag">未同步</span>{/if}
                  </button>
                {:else}
                  <span class="entry-name">{entry.title}</span>
                {/if}
                {#if meta}<span class="entry-meta">{meta}</span>{/if}
              </li>
            {/each}
          </ol>
        {:else if feed?.status === 'ok'}
          <p class="feed-empty">这天没有日程</p>
        {/if}
      </div>
    {/if}
  </div>

  <EventDialog bind:this={editor} {id} {today} {timeZone} onsaved={reload} />

  {#if failedKey || notice || !feed || unsyncedCount > 0}
  <div class="cal-foot">
    {#if failedKey}
      <p class="feed-notice" data-kind="error">
        {failedKey.year}年{failedKey.month}月的日程没有取到
        <button type="button" class="cal-link" onclick={retry}>重试</button>
      </p>
    {:else if notice}
      <p class="feed-notice" data-kind={notice.kind}>
        {notice.text}
        {#if notice.kind === 'error'}<button type="button" class="cal-link" onclick={retry}>重试</button>{/if}
      </p>
    {:else if !feed}
      <p class="feed-notice">正在读取日程…</p>
    {:else if unsyncedCount > 0}
      <p class="feed-notice">
        {unsyncedCount} 件日程还没同步到 Google 日历{shown?.syncError ? `：${shown.syncError}` : ''}
        <button type="button" class="cal-link" disabled={syncing} onclick={retrySync}>{syncing ? '正在同步…' : '重试'}</button>
      </p>
    {/if}
  </div>
  {/if}
</div>

<style>
  /*
   * 手帐的月历页：大号月份数字旁边是年份和季节；周一在前。今天被红笔圈了两圈，
   * 有日程的日子下面划一道蓝线，周末和法定假日的数字用蓝色，调休的日子右上角有「休」「班」
   */
  .cal-month {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.875rem;
    margin-bottom: 0.5rem;
  }

  .m {
    font: 400 5rem / 0.9 var(--serif);
  }

  .y {
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .cal-nav {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    margin-inline-start: auto;
  }

  .cal-step,
  .cal-today,
  .cal-link {
    padding: 0;
    background: none;
    border: 0;
  }

  .cal-step {
    min-inline-size: 1.75rem;
    min-block-size: 1.75rem;
    font: 400 var(--text-2xl) / 1 var(--serif);
    color: var(--ink-2);
  }

  .cal-step:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .cal-today {
    margin-inline-end: 0.375rem;
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--blue);
  }

  @media (hover: hover) {
    .cal-step:not(:disabled):hover {
      color: var(--ink);
    }

    .cal-today:hover,
    .cal-link:hover {
      text-decoration: underline;
    }
  }

  /* 翻页的请求慢于一眨眼才变淡，快的不闪 */
  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    transition: opacity var(--dur-fast) linear;
  }

  .cal-grid[aria-busy='true'] {
    opacity: 0.55;
    /* 很快就回来的请求不闪一下 */
    transition-delay: var(--dur-draw);
  }

  .wd {
    padding-block: 0.375rem;
    font: var(--text-sm) / 1 var(--label);
    color: var(--ink-3);
    text-align: center;
    border-bottom: var(--rule-thin);
  }

  .cell {
    position: relative;
    isolation: isolate;
    display: grid;
    justify-items: center;
    min-inline-size: 0;
    padding: 0.4375rem 0 0.375rem;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--rule-soft);
  }

  .cell b {
    font: 400 1.125rem / 1.2 var(--serif);
  }

  .cell i {
    max-inline-size: 100%;
    overflow: hidden;
    font-size: var(--text-2xs);
    font-style: normal;
    color: var(--ink-3);
    white-space: nowrap;
  }

  .cell.rest b,
  .cell.fest i {
    color: var(--blue);
  }

  .cell.out {
    opacity: 0.38;
  }

  /* 红笔圈两圈：两道歪一点的椭圆，一粗一细 */
  .cell.today::before,
  .cell.today::after {
    content: '';
    position: absolute;
    inset: 1px -1px;
    border: 2px solid var(--red);
    border-radius: 55% 45% 52% 48% / 50% 58% 42% 50%;
    rotate: -9deg;
    pointer-events: none;
  }

  .cell.today::after {
    inset: 3px 0 0 2px;
    border-width: 1px;
    rotate: 6deg;
    opacity: 0.7;
  }

  .cell.today b {
    font-weight: 700;
    color: var(--red);
  }

  .due {
    position: absolute;
    inset-block-end: 2px;
    inset-inline-start: 50%;
    inline-size: 14px;
    block-size: 2px;
    translate: -50% 0;
    background: var(--blue);
  }

  .badge {
    position: absolute;
    inset-block-start: 1px;
    inset-inline-end: 2px;
    font: var(--text-2xs) / 1 var(--label);
  }

  .badge[data-kind='rest'] {
    color: var(--blue);
  }

  .badge[data-kind='work'] {
    color: var(--ink-3);
  }

  /* 悬停、选中时铺一层淡樱色，选中的上沿再多一道深樱色；只动透明度 */
  .wash {
    position: absolute;
    inset: 1px;
    z-index: -1;
    background: var(--sakura-wash);
    opacity: 0;
    transition: opacity var(--dur-hover) var(--ease-out);
  }

  .cell[aria-pressed='true'] .wash {
    opacity: 1;
    box-shadow: inset 0 2px 0 var(--sakura-deep);
  }

  @media (hover: hover) {
    .cell:hover .wash {
      opacity: 1;
    }
  }

  /* 选中那天的日程：第一次展开时淡入、下落一点，之后换日子只换内容 */
  .cal-day {
    margin-block-start: 0.75rem;
    padding-block-start: 0.625rem;
    border-top: var(--rule-thin);
    transition:
      opacity var(--dur-open) var(--ease-out),
      translate var(--dur-open) var(--ease-out);
  }

  @starting-style {
    .cal-day {
      opacity: 0;
      translate: 0 -4px;
    }
  }

  .cal-day-head {
    margin-block-end: 0.25rem;
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-2);
  }

  /* 与「今天」版块同样的行：时间、事项名按基线对齐，地点在事项名下面 */
  .cal-entries {
    padding: 0;
    list-style: none;
  }

  .entry {
    display: grid;
    grid-template-columns: 3.8rem minmax(0, 1fr);
    column-gap: 0.5rem;
    align-items: baseline;
    padding-block: 0.4375rem;
  }

  .entry + .entry {
    border-top: var(--rule-thin);
  }

  .entry-time {
    grid-row: span 2;
    font: 400 var(--text-xl) / 1.2 var(--serif);
    white-space: nowrap;
  }

  .entry-name {
    font-size: var(--text-base);
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .entry-meta {
    grid-column: 2;
    font: var(--text-xs) / 1.4 var(--num);
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }

  .cal-foot {
    margin-block-start: 0.75rem;
    padding-block-start: 0.625rem;
    border-top: var(--rule-thin);
  }

  .cal-link {
    color: var(--blue);
  }

  .cal-new {
    margin-inline-end: 0.75rem;
  }

  /* 自己添加的日程：事项名可以点，点开修改；悬停时下面一道虚线 */
  .entry-edit {
    padding: 0;
    color: inherit;
    text-align: start;
    background: none;
    border: 0;
  }

  .entry-tag {
    margin-inline-start: 0.5rem;
    padding: 0 0.3rem;
    font: var(--text-2xs) / 1.6 var(--label);
    font-weight: 400;
    color: var(--ink-3);
    vertical-align: 0.1em;
    border: 1px solid currentcolor;
  }

  @media (hover: hover) {
    .entry-edit:hover {
      text-decoration: underline dashed;
      text-underline-offset: 3px;
    }
  }

  .feed-notice .cal-link {
    margin-inline-start: 0.375rem;
  }
</style>
