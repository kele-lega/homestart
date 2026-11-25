<script lang="ts">
  /**
   * 「问」：留白首页正中的搜索。逻辑和旧版 Search.svelte 是同一套（widgets/search/options）：
   * 匹配的网站 → 用搜索引擎搜输入的内容 → 联想词；回车执行高亮的一项，上下键移动，Esc 一步一步退。
   * 不同的地方：
   * - 搜索引擎是右边几个字（谷、必、扬、百），点一下换。layout.yaml / 设置页里排第一的是默认，
   *   在这台设备上点过别的就记住（localStorage）；设置页换了默认以后，记住的作废，回到新的默认
   * - 输入时首页的最近访问和分类收起来，结果列在原来的位置（.home[data-q]）
   * - 记得最近搜过的十条（只在这台设备上，widgets/search/history）：点进空的输入框就列出来，
   *   打字时对得上的几条排在联想前面；行尾的 × 或者选中后按 Delete 删一条，「清空」全删
   * 全局快捷键（/、直接打字）在 router.ts 里，聚焦的是这里的输入框 #ink-q
   */
  import { onMount, untrack } from 'svelte';
  import { isComposing } from '../../lib/keyboard';
  import { fetchAction } from '../../lib/widget-api';
  import SiteIcon from '../../components/SiteIcon.svelte';
  import { ENGINES, type EngineId } from '../../widgets/search/engines';
  import {
    announce,
    buildOptions,
    isSuggestable,
    keepsChoice,
    optionId,
    readSuggestions,
    resolveActive,
    stepKey,
    targetOf,
    type SearchOption,
  } from '../../widgets/search/options';
  import { forget, HISTORY_KEY, parseHistory, remember } from '../../widgets/search/history';
  import type { SiteEntry } from '../../widgets/search/sites';

  interface Props {
    id: string;
    /** 配置的搜索引擎，第一个是默认 */
    engines: readonly EngineId[];
    sites: readonly SiteEntry[];
    suggest: boolean;
    /** 配置里改过的提示语；没改过时用留白自己的 */
    placeholder?: string | undefined;
  }

  let { id, engines, sites, suggest, placeholder }: Props = $props();

  const SUGGEST_DELAY_MS = 150;
  const ANNOUNCE_DELAY_MS = 500;
  const SUGGEST_WAIT_MS = 1000;
  const ENGINE_KEY = 'home:ink-engine';
  const GLYPH: Readonly<Record<EngineId, string>> = { google: '谷', bing: '必', yandex: '扬', baidu: '百' };

  let input: HTMLInputElement | undefined;
  let query = $state('');
  let suggestions = $state<readonly string[]>([]);
  let chosen = $state<string | undefined>();
  let focused = $state(false);
  let dismissed = $state(false);
  let navigated = $state(false);
  let held: string | undefined;
  let status = $state('');
  let pending = $state(false);
  // 服务端渲染时用默认引擎；挂载后读这台设备记住的
  let engine = $state<EngineId>(untrack(() => engines[0] ?? 'bing'));
  let history = $state<readonly string[]>([]);

  const options = $derived(buildOptions(query, sites, suggestions, history));
  const recent = $derived(query.trim() === '');
  const siteOptions = $derived(options.filter((option) => option.kind === 'site'));
  const searchOptions = $derived(options.filter((option) => option.kind !== 'site'));
  const active = $derived(resolveActive(options, chosen, query));
  const open = $derived(focused && !dismissed && options.length > 0);
  const listId = $derived(`${id}-results`);
  const hint = $derived(
    placeholder ? placeholder.replaceAll('{engine}', ENGINES[engine].name) : '想去哪里，或者想知道什么',
  );
  const rowId = (option: SearchOption) => optionId(id, option.key);
  const activeId = $derived.by(() => {
    const option = options.find((candidate) => candidate.key === active);
    return option ? rowId(option) : undefined;
  });

  // 有结果时首页的最近访问、分类让位给结果
  $effect(() => {
    const home = input?.closest<HTMLElement>('.home');
    home?.toggleAttribute('data-q', open);
    return () => home?.removeAttribute('data-q');
  });

  $effect(() => {
    const text = query.trim();
    if (!suggest || !isSuggestable(text)) {
      suggestions = [];
      pending = false;
      return;
    }
    pending = true;
    const controller = new AbortController();
    const timer = setTimeout(() => void loadSuggestions(text, controller.signal), SUGGEST_DELAY_MS);
    const giveUp = setTimeout(() => (pending = false), SUGGEST_WAIT_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(giveUp);
      controller.abort();
    };
  });

  async function loadSuggestions(text: string, signal: AbortSignal) {
    let list: readonly string[] = [];
    try {
      list = readSuggestions(await fetchAction(id, 'suggest', { q: text }, signal));
    } catch {
      // 联想失败时只显示网站和搜索引擎
    }
    if (signal.aborted) return;
    pending = false;
    if (keepsChoice(buildOptions(text, sites, list, history), held)) suggestions = list;
  }

  const announcement = $derived(open && !navigated && !pending ? announce(options, active, engine) : '');
  $effect(() => {
    void query;
    const text = announcement;
    const timer = setTimeout(() => (status = text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  });

  /** 别的标签页里也可能搜过：每次点进来重新读一遍 */
  function loadHistory(): void {
    try {
      history = parseHistory(localStorage.getItem(HISTORY_KEY));
    } catch {
      history = [];
    }
  }

  function saveHistory(next: readonly string[]): void {
    history = next;
    try {
      if (next.length === 0) localStorage.removeItem(HISTORY_KEY);
      else localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // 存不下：这次照样显示
    }
  }

  /** 删掉一条旧记录；高亮挪到下一条（删的是最后一条就挪到上一条） */
  function drop(option: Extract<SearchOption, { kind: 'history' }>): void {
    const index = options.findIndex((candidate) => candidate.key === option.key);
    const neighbor = options[index + 1] ?? options[index - 1];
    saveHistory(forget(history, option.text));
    if (chosen === option.key) chosen = held = neighbor?.key;
  }

  onMount(() => {
    loadHistory();
    focused = document.activeElement === input;
    try {
      const saved = JSON.parse(localStorage.getItem(ENGINE_KEY) ?? 'null') as { base?: unknown; pick?: unknown } | null;
      if (saved && saved.base === engines[0] && engines.includes(saved.pick as EngineId)) engine = saved.pick as EngineId;
    } catch {
      // 读不出来就用默认
    }
  });

  function pickEngine(next: EngineId): void {
    engine = next;
    try {
      if (next === engines[0]) localStorage.removeItem(ENGINE_KEY);
      else localStorage.setItem(ENGINE_KEY, JSON.stringify({ base: engines[0], pick: next }));
    } catch {
      // 存不下：这次照样用
    }
    const text = query.trim();
    if (text === '') input?.focus();
  }

  function reveal(key: string | undefined) {
    chosen = key;
    held = key;
    dismissed = false;
    navigated = true;
    requestAnimationFrame(() => {
      if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onKeydown(event: KeyboardEvent) {
    if (isComposing(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return;
      event.preventDefault();
      reveal(open ? stepKey(options, active, event.key === 'ArrowDown' ? 1 : -1) : active);
      return;
    }
    if (event.key === 'Delete' && open && navigated) {
      const option = options.find((candidate) => candidate.key === active);
      if (option?.kind === 'history') {
        event.preventDefault();
        drop(option);
      }
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (open) dismissed = true;
    else if (query !== '') clear();
    else input?.blur();
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const text = query.trim();
    const option = open ? options.find((candidate) => candidate.key === active) : undefined;
    if (option) activate(option);
    else if (text !== '') activate({ kind: 'web', key: 'web', text });
  }

  function activate(option: SearchOption) {
    if (option.kind !== 'site') saveHistory(remember(history, option.text));
    openInNewTab(targetOf(option, engine), option.kind === 'site');
    reset();
  }

  // 用真实链接点击打开：网站带 data-visit（记进最近访问、算一次导航），搜索引擎带 data-hit="search"（算一次搜索）
  function openInNewTab(url: string, visit: boolean) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (visit) link.dataset.visit = '';
    else link.dataset.hit = 'search';
    document.body.append(link);
    link.click();
    link.remove();
  }

  function reset() {
    query = '';
    chosen = undefined;
    held = undefined;
    dismissed = false;
    navigated = false;
    suggestions = [];
  }

  function clear() {
    reset();
    input?.focus();
  }

  function onFocusIn() {
    if (!focused) {
      dismissed = false;
      loadHistory();
    }
    focused = true;
  }

  function onFocusOut(event: FocusEvent & { currentTarget: HTMLElement }) {
    const next = event.relatedTarget;
    if (!(next instanceof Node && event.currentTarget.contains(next))) focused = false;
  }

  function optionAt(target: EventTarget | null): SearchOption | undefined {
    const key = target instanceof Element ? target.closest<HTMLElement>('[data-key]')?.dataset.key : undefined;
    return options.find((option) => option.key === key);
  }

  function onPointerMove(event: PointerEvent) {
    const option = optionAt(event.target);
    if (option && option.key !== active) chosen = option.key;
  }

  function onListClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-clear]')) {
      saveHistory([]);
      return;
    }
    const option = optionAt(target);
    if (!option) return;
    if (option.kind === 'history' && target?.closest('[data-del]')) drop(option);
    else activate(option);
  }

  /** 名字里和输入相同的那一段用朱砂 */
  function split(text: string, needle: string): readonly [string, string, string] {
    const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
    if (at < 0) return [text, '', ''];
    return [text.slice(0, at), text.slice(at, at + needle.length), text.slice(at + needle.length)];
  }
</script>

<div class="ask-wrap" role="search" onfocusin={onFocusIn} onfocusout={onFocusOut}>
  <form class="ask" action={ENGINES[engine].action} target="_blank" rel="noopener noreferrer" autocomplete="off" onsubmit={onSubmit}>
    <span class="q" aria-hidden="true">问</span>
    <input
      bind:this={input}
      bind:value={query}
      oninput={() => {
        chosen = undefined;
        held = undefined;
        dismissed = false;
        navigated = false;
      }}
      onkeydown={onKeydown}
      id="ink-q"
      type="text"
      name={ENGINES[engine].param}
      role="combobox"
      aria-label="搜索"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open && navigated ? activeId : undefined}
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="search"
      placeholder={hint}
    />
    {#if engines.length > 1}
      <div class="eng" role="radiogroup" aria-label="搜索引擎">
        {#each engines as candidate (candidate)}
          <button
            type="button"
            role="radio"
            aria-checked={candidate === engine}
            title={ENGINES[candidate].name}
            aria-label={ENGINES[candidate].name}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => pickEngine(candidate)}>{GLYPH[candidate]}</button
          >
        {/each}
      </div>
    {/if}
    <svg class="stroke" viewBox="0 0 600 18" preserveAspectRatio="none" aria-hidden="true">
      <path filter="url(#rough)" d="M2 11 C80 6 160 13 260 9 S470 5 598 10" />
    </svg>
  </form>

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="res"
    id={listId}
    role="listbox"
    aria-label="搜索结果"
    tabindex="-1"
    hidden={!open}
    onmousedown={(event) => event.preventDefault()}
    onpointermove={onPointerMove}
    onclick={onListClick}
  >
    {#if siteOptions.length > 0}
      <div role="group" aria-label="网站">
        <p class="hd" aria-hidden="true">网 站</p>
        {#each siteOptions as option (option.key)}
          {@const [before, hit, after] = split(option.site.name, query.trim())}
          <div class="row" id={rowId(option)} role="option" aria-selected={option.key === active} data-key={option.key}>
            <SiteIcon name={option.site.name} icon={option.site.icon} iconDark={option.site.iconDark} size="xs" />
            <span>{before}<mark>{hit}</mark>{after}</span>
            <small>{option.site.host}</small>
          </div>
        {/each}
      </div>
    {/if}
    <div role="group" aria-label={recent ? '最近搜过' : `用 ${ENGINES[engine].name} 搜索`}>
      {#if recent}
        <!-- 「清空」只给鼠标用；键盘选中一条按 Delete 删 -->
        <p class="hd" aria-hidden="true">最 近<span class="clr" data-clear>清空</span></p>
      {:else}
        <p class="hd" aria-hidden="true">搜 索</p>
      {/if}
      {#each searchOptions as option (option.key)}
        <div class="row" id={rowId(option)} role="option" aria-selected={option.key === active} data-key={option.key}>
          {#if option.kind === 'web'}
            <span class="k" aria-hidden="true">{GLYPH[engine]}</span>
            <span>用 {ENGINES[engine].name} 搜「{option.text}」</span>
            <small aria-hidden="true">{option.key === active ? '回车' : ''}</small>
          {:else if option.kind === 'history'}
            {@const [before, hit, after] = split(option.text, query.trim())}
            <span class="k" aria-hidden="true">忆</span>
            <span>{before}<mark>{hit}</mark>{after}</span>
            <span class="end" aria-hidden="true">
              <small>{option.key === active ? '回车' : recent ? '' : '搜过'}</small>
              <span class="del" data-del title="删去这条">×</span>
            </span>
          {:else}
            {@const [before, hit, after] = split(option.text, query.trim())}
            <span class="k" aria-hidden="true">·</span>
            <span>{before}<mark>{hit}</mark>{after}</span>
            <small aria-hidden="true">{option.key === active ? '回车' : '联想'}</small>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  <p class="visually-hidden" role="status">{status}</p>
</div>
