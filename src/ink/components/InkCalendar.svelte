<script lang="ts">
  /**
   * 月令：左边一个月的格子，右边选中那天的日程和「添一笔」。数据和旧版 Calendar.svelte 同一套：
   * 服务端先画好本月的格子（农历、节气、法定假日不进浏览器），挂载后经 month 操作取这几周的日程，翻页时连格子一起取；
   * 翻过的月份留五分钟。登录后能在选中的那天快速记一笔（标题 + 钟点，一小时），「详」打开完整的编辑框（全天、跨天、地点）；
   * 点自己添加的那件可以修改、删除，订阅里的只能看。连了 Google 日历时，没推过去的标「未同步」，底下能重试。
   * 首页的条幅点进来时（地址带 ?date=，或者 router 发的 ink:pick）翻到那个月、选中那天
   */
  import { onMount, tick } from 'svelte';
  import { draftFields, fieldsProblem, moveStart, isTimeText } from '../../lib/event-fields';
  import { feedNotice } from '../../lib/feed-view';
  import { readResult } from '../../lib/settings-api';
  import { fetchAction, sendAction } from '../../lib/widget-api';
  import { localTimeText } from '../../lib/zoned-time';
  import { cacheable, moveInGrid, pageDelta, readMonth } from '../../widgets/calendar/client';
  import type { MonthData } from '../../widgets/calendar/data';
  import EventDialog from '../../widgets/calendar/EventDialog.svelte';
  import type { MonthGrid } from '../../widgets/calendar/month';
  import { formatMonthKey, inRange, monthOfDate, sameMonth, shiftMonth, WEEKDAY_HEADS, type MonthKey } from '../../widgets/calendar/month-key';
  import { cnMonth, cnNumber, cnYear } from '../text';

  interface Props {
    id: string;
    initial: MonthGrid;
    /** 站点时区的今天 'YYYY-MM-DD' */
    today: string;
    timeZone: string;
  }

  let { id, initial, today, timeZone }: Props = $props();

  const CACHE_MS = 5 * 60_000;
  const ALL_DAY = '全天';
  const CONTINUED = '—';
  const ENSO = 'M78 18 C62 4 28 6 13 28 C-2 52 12 86 44 92 C76 98 98 74 94 46 C92 34 86 26 80 22';
  const cache = new Map<string, { readonly data: MonthData; readonly at: number }>();
  let controller: AbortController | undefined;
  let editor = $state<EventDialog>();

  let shown = $state.raw<MonthData | undefined>(undefined);
  let wanted = $state.raw<MonthKey | undefined>(undefined);
  let failedKey = $state.raw<MonthKey | undefined>(undefined);
  // svelte-ignore state_referenced_locally
  let selected = $state<string>(today);
  let focusDate = $state<string | undefined>(undefined);
  let pending = $state(false);
  let gridEl = $state<HTMLElement | undefined>(undefined);
  let syncing = $state(false);

  // 添一笔
  let draftTitle = $state('');
  let draftTime = $state('');
  let adding = $state(false);
  let addNote = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);

  const grid = $derived(shown?.grid ?? initial);
  const shownKey = $derived<MonthKey>({ year: grid.year, month: grid.month });
  const baseKey = $derived(wanted ?? shownKey);
  const todayKey = $derived(monthOfDate(today));
  const onTodayMonth = $derived(sameMonth(baseKey, todayKey) && selected === today);
  const canPrev = $derived(inRange(shiftMonth(baseKey, -1)));
  const canNext = $derived(inRange(shiftMonth(baseKey, 1)));

  const feed = $derived(shown?.feed);
  const byDay = $derived(feed?.status === 'ok' ? feed.data : {});
  const notice = $derived(feed && feedNotice(feed));
  const own = $derived(shown?.own);
  const unsyncedCount = $derived(shown?.pending ?? 0);

  const selectedCell = $derived(grid.cells.find((cell) => cell.date === selected));
  const entries = $derived(byDay[selected] ?? []);
  const tabDate = $derived.by(() => {
    const dates = new Set(grid.cells.map((cell) => cell.date));
    return [focusDate, selected, today].find((date) => date !== undefined && dates.has(date)) ?? grid.cells[0]?.date;
  });
  /** 「10月1日 星期四」和「农历八月廿一 · 国庆」两行，从格子的读屏说明里拆出来 */
  const heading = $derived.by(() => {
    const [date = '', ...rest] = (selectedCell?.description ?? '').split('，');
    return { date: date.replace(' ', '　'), detail: rest.join(' · ') };
  });

  function show(data: MonthData): void {
    shown = data;
    // 换了月份、选中的那天不在这页里：选今天（本月）或 1 号
    if (!data.grid.cells.some((cell) => cell.date === selected && !cell.outside)) {
      selected = landingDate({ year: data.grid.year, month: data.grid.month });
    }
  }

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
      if (!current.signal.aborted) failedKey = key;
    } finally {
      if (controller === current) {
        controller = undefined;
        wanted = undefined;
        pending = false;
      }
    }
  }

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

  async function toToday(): Promise<void> {
    selected = today;
    await request(todayKey);
  }

  /** 选中某天；不在这页里就先翻过去 */
  async function pick(date: string): Promise<void> {
    selected = date;
    const key = monthOfDate(date);
    if (!sameMonth(key, shownKey) || !grid.cells.some((cell) => cell.date === date && !cell.outside)) await request(key);
    selected = date;
  }

  function choose(date: string): void {
    focusDate = date;
    const cell = grid.cells.find((candidate) => candidate.date === date);
    if (cell?.outside) void pick(date);
    else selected = date;
  }

  function onCellKey(event: KeyboardEvent, index: number): void {
    const delta = pageDelta(event.key);
    if (delta) {
      event.preventDefault();
      if (!event.repeat) void go(delta, true);
      return;
    }
    const target = moveInGrid(event.key, index, grid.cells.length);
    if (target === undefined) return;
    event.preventDefault();
    void focusCell(grid.cells[target]!.date);
  }

  function cellLabel(date: string, description: string, isToday: boolean): string {
    const count = byDay[date]?.length ?? 0;
    const [head, ...rest] = description.split('，');
    return [head, ...(isToday ? ['今天'] : []), ...rest, ...(count > 0 ? [`${count} 件日程`] : [])].join('，');
  }

  function reload(): void {
    cache.clear();
    void request(shownKey);
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
    void request(failedKey ?? shownKey);
  }

  /** 新建的默认钟点：今天是下一个整点，别的日子 9 点 */
  const defaultTime = $derived(draftFields(selected, today, localTimeText(Date.now(), timeZone)).startTime);
  // 换了一天，钟点回到那天的默认
  $effect(() => {
    draftTime = defaultTime;
  });

  async function onAdd(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title) return;
    const base = draftFields(selected, today, localTimeText(Date.now(), timeZone));
    const time = isTimeText(draftTime) ? draftTime : base.startTime;
    const fields = { ...moveStart(base, { date: selected, time }), title };
    const problem = fieldsProblem(fields);
    if (problem) {
      addNote = { kind: 'error', text: problem };
      return;
    }
    adding = true;
    addNote = undefined;
    let result;
    try {
      result = readResult(await sendAction(id, 'create', { method: 'POST', body: fields }));
    } catch {
      result = { ok: false as const, message: '网络出了点问题，没能记下' };
    }
    adding = false;
    if (!result.ok) {
      addNote = { kind: 'error', text: result.message };
      return;
    }
    draftTitle = '';
    draftTime = defaultTime;
    addNote = { kind: 'ok', text: '记下了' };
    reload();
  }

  function openDetail(): void {
    void editor?.create(selected);
  }

  // 首页底下「月令」入口的小字：今天有几件事（订阅读到了才改）
  $effect(() => {
    if (!feed || feed.status !== 'ok' || !sameMonth(shownKey, todayKey)) return;
    const count = feed.data[today]?.length ?? 0;
    const hint = document.querySelector<HTMLElement>('[data-hint="cal"]');
    if (hint) hint.textContent = count > 0 ? `今日${cnNumber(count)}事` : '今日无事';
  });

  function onPick(event: Event): void {
    const date = (event as CustomEvent<string>).detail;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) void pick(date);
  }

  onMount(() => {
    addEventListener('ink:pick', onPick);
    const date = new URLSearchParams(location.search).get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && inRange(monthOfDate(date))) void pick(date);
    else void request(shownKey);
    return () => {
      removeEventListener('ink:pick', onPick);
      controller?.abort();
    };
  });
</script>

<div class="cal-month">
  <div class="mh">
    <b>{cnMonth(baseKey.month)}</b>
    <span>{cnYear(baseKey.year)}年</span>
    <span class="visually-hidden" aria-live="polite">{baseKey.year}年{baseKey.month}月</span>
    <nav aria-label="翻月">
      <button type="button" aria-label="上个月" disabled={!canPrev} onclick={() => go(-1)}>‹</button>
      <button type="button" aria-label="回到今天" disabled={onTodayMonth} onclick={toToday}>今</button>
      <button type="button" aria-label="下个月" disabled={!canNext} onclick={() => go(1)}>›</button>
    </nav>
  </div>
  <div class="grid" role="group" aria-label="{grid.year}年{grid.month}月" aria-busy={pending} bind:this={gridEl}>
    {#each WEEKDAY_HEADS as head}
      <span class="wk" aria-hidden="true">{head}</span>
    {/each}
    {#each grid.cells as cell, index (cell.date)}
      {@const count = byDay[cell.date]?.length ?? 0}
      <button
        type="button"
        class="day"
        class:out={cell.outside}
        class:we={cell.rest}
        class:is-today={cell.today}
        data-date={cell.date}
        tabindex={cell.date === tabDate ? 0 : -1}
        aria-pressed={cell.date === selected}
        aria-label={cellLabel(cell.date, cell.description, cell.today)}
        onclick={() => choose(cell.date)}
        onkeydown={(event) => onCellKey(event, index)}
        onfocus={() => (focusDate = cell.date)}
      >
        {#if cell.today}
          <svg viewBox="0 0 100 100" aria-hidden="true"><path filter="url(#rough)" d={ENSO} /></svg>
        {/if}
        <span class="n">{cell.day}</span>
        <span class="l" class:t={cell.accent}>{cell.label}</span>
        {#if cell.badge}<span class="badge" data-kind={cell.badge === '班' ? 'work' : 'rest'}>{cell.badge}</span>{/if}
        {#if count > 0}
          <span class="dots" aria-hidden="true">
            {#each Array.from({ length: Math.min(3, count) }) as _}<i></i>{/each}
          </span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<div class="dd" aria-live="polite">
  <h2 class="dd-h">{heading.date}</h2>
  <p class="sub2">{heading.detail}</p>

  {#if failedKey}
    <p class="feed-notice" data-kind="error">
      {failedKey.year}年{failedKey.month}月的日程没有取到 <button type="button" class="inline" onclick={retry}>重试</button>
    </p>
  {:else if notice}
    <p class="feed-notice" data-kind={notice.kind}>
      {notice.text}
      {#if notice.kind === 'error'}<button type="button" class="inline" onclick={retry}>重试</button>{/if}
    </p>
  {/if}

  {#each entries as entry (entry.id)}
    {@const mine = own?.[entry.id]}
    {@const meta = [entry.until && `至 ${entry.until}`, entry.location].filter(Boolean).join(' · ')}
    <div class="ev">
      <time>{entry.time === ALL_DAY ? '全天' : entry.time === CONTINUED ? '续' : entry.time}</time>
      <span>
        {#if mine}
          <button type="button" class="ev-edit" aria-label="修改 {entry.title}" onclick={() => editor?.edit(entry.id, mine.fields)}
            >{entry.title}</button
          >{#if mine.unsynced}<span class="tag">未同步</span>{/if}
        {:else}
          {entry.title}
        {/if}
        {#if meta}<em>{meta}</em>{/if}
      </span>
    </div>
  {:else}
    {#if feed?.status === 'ok' || feed?.status === 'unconfigured'}
      <p class="none">这一天是空白的。</p>
    {:else if !feed && !failedKey}
      <p class="none">正在读取……</p>
    {/if}
  {/each}

  {#if own}
    <form class="add" onsubmit={onAdd}>
      <label class="visually-hidden" for="{id}-add-title">在这一天添一笔</label>
      <input id="{id}-add-title" bind:value={draftTitle} placeholder="添一笔……" maxlength="200" autocomplete="off" />
      <label class="visually-hidden" for="{id}-add-time">钟点</label>
      <input id="{id}-add-time" type="time" step="60" bind:value={draftTime} />
      <button type="button" class="ghost" onclick={openDetail} title="全天、跨天、地点">详</button>
      <button type="submit" class="seal" aria-label="记下" disabled={adding || draftTitle.trim() === ''}>记</button>
    </form>
    {#if addNote}
      <p class="add-note" data-kind={addNote.kind} role={addNote.kind === 'error' ? 'alert' : 'status'}>{addNote.text}</p>
    {/if}
  {:else if feed}
    <p class="none"><a class="inline" href="/login">登录</a>后可以在这里添日程。</p>
  {/if}

  {#if unsyncedCount > 0}
    <p class="feed-notice">
      {unsyncedCount} 件日程还没同步到 Google 日历{shown?.syncError ? `：${shown.syncError}` : ''}
      <button type="button" class="inline" disabled={syncing} onclick={retrySync}>{syncing ? '正在同步…' : '重试'}</button>
    </p>
  {/if}
</div>

<EventDialog bind:this={editor} {id} {today} {timeZone} onsaved={reload} />
