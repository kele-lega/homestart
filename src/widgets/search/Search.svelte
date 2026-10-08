<!--
  搜索岛：本地网站模糊匹配 + 外部搜索引擎 + 可选联想词。
  没有 JS 时表单照样能提交给默认搜索引擎；有 JS 时回车走 submit（输入法安全），由 activate 统一打开。
  只能引用浏览器端安全的模块（widget.ts / suggest.ts 属于服务端）。
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { isComposing } from '../../lib/keyboard';
  import { fetchAction } from '../../lib/widget-api';
  import { ENGINES, type EngineId } from './engines';
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
  } from './options';
  import type { SiteEntry } from './sites';
  import SearchRow from './SearchRow.svelte';

  interface Props {
    id: string;
    /** 在用的搜索引擎：配置里的第一个，登录用户可以在设置页换 */
    engine: EngineId;
    sites: readonly SiteEntry[];
    suggest: boolean;
    placeholder: string;
  }

  let { id, engine, sites, suggest, placeholder }: Props = $props();

  const SUGGEST_DELAY_MS = 150;
  // 停止输入后再播报，不打断读屏逐字回读输入的内容
  const ANNOUNCE_DELAY_MS = 500;
  // 联想最多等这么久再播报；网络卡住时先说已有的选项，联想到了再更新
  const SUGGEST_WAIT_MS = 1000;

  let input: HTMLInputElement | undefined;
  let query = $state('');
  let suggestions = $state<readonly string[]>([]);
  let chosen = $state<string | undefined>();
  let focused = $state(false);
  let dismissed = $state(false);
  // 只有用方向键移动过高亮，才把读屏焦点（aria-activedescendant）交给列表
  let navigated = $state(false);
  // 方向键选中的那一项；之后鼠标悬停会改 chosen，但不改它。只在异步回调里读，不需要响应式
  let held: string | undefined;
  let status = $state('');
  // 联想请求还没回来：先不播报，免得停顿时说一遍、联想到了又说一遍
  let pending = $state(false);

  const options = $derived(buildOptions(query, sites, suggestions));
  const siteOptions = $derived(options.filter((option) => option.kind === 'site'));
  const searchOptions = $derived(options.filter((option) => option.kind !== 'site'));
  const active = $derived(resolveActive(options, chosen, query));
  const open = $derived(focused && !dismissed && options.length > 0);
  const listId = $derived(`${id}-results`);
  const inputId = $derived(`${id}-input`);
  // {engine} 换成当前搜索引擎的名称
  const hint = $derived(placeholder.replaceAll('{engine}', ENGINES[engine].name));
  const rowId = (option: SearchOption) => optionId(id, option.key);
  const activeId = $derived.by(() => {
    const option = options.find((candidate) => candidate.key === active);
    return option ? rowId(option) : undefined;
  });

  // 联想：停止输入 150ms 后请求；新输入会取消旧请求，旧结果保留到新结果到达
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
      // 联想只是锦上添花：失败时只显示网站和搜索引擎。服务端只记录自身出错（5xx）和首次拒绝的跨站请求，
      // 限流、参数错误不记录；断网等浏览器端失败在这里静默忽略
    }
    if (signal.aborted) return;
    pending = false;
    // 方向键选中的联想词不在新结果里时先保留旧列表，免得高亮跳走；鼠标悬停不算选定。下一次输入会重新请求
    if (keepsChoice(buildOptions(text, sites, list), held)) suggestions = list;
  }

  // 读屏播报：停止输入后说一次有几个选项、回车会做什么；方向键移动时由 aria-activedescendant 播报当前行
  const announcement = $derived(open && !navigated && !pending ? announce(options, active, engine) : '');
  $effect(() => {
    // 每次输入都重新计时：播报内容没变时也要等停下来再说，不打断读屏回读输入
    void query;
    const text = announcement;
    const timer = setTimeout(() => (status = text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    // 岛屿激活前就点进了输入框时 focusin 已经错过（输入的内容由 bind:value 在激活时读回）
    focused = document.activeElement === input;
  });

  function isTyping(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  // 全局快捷键：不在输入时按 / 聚焦搜索框
  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isComposing(event)) return;
    if (isTyping(event.target)) return;
    event.preventDefault();
    input?.focus();
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

  // 上下键在选项间移动（面板被 Esc 收起时先重新展开）；Esc 依次收起面板、清空、失焦，
  // 每次只退一步，并标记为已处理，分类导航等其它监听 Esc 的地方不会跟着收起
  function onKeydown(event: KeyboardEvent) {
    if (isComposing(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return;
      event.preventDefault();
      reveal(open ? stepKey(options, active, event.key === 'ArrowDown' ? 1 : -1) : active);
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (open) dismissed = true;
    else if (query !== '') clear();
    else input?.blur();
  }

  // 面板收起时回车只按输入内容搜索，不执行看不见的高亮项
  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const text = query.trim();
    if (text === '') return;
    const option = open ? options.find((candidate) => candidate.key === active) : undefined;
    activate(option ?? { kind: 'web', key: 'web', text });
  }

  // 点搜索引擎签：不管高亮的是哪项，都用搜索引擎搜输入的内容；什么都没输入时把焦点交给输入框
  function onEngineClick() {
    const text = query.trim();
    if (text === '') input?.focus();
    else activate({ kind: 'web', key: 'web', text });
  }

  function activate(option: SearchOption) {
    openInNewTab(targetOf(option, engine), option.kind === 'site');
    reset();
  }

  // 用真实链接点击打开新标签页：行为与普通链接一致，不会被当成弹窗。
  // 打开的是 links.yaml 里的网站时带上 data-visit，和别处点开的网站一样记进常用网站、算一次导航；
  // 打开搜索引擎时带上 data-hit="search"，首页「本站」版块的搜索次数加一
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
    if (!focused) dismissed = false;
    focused = true;
  }

  // 焦点只在表单内部移动（输入框 → 清空按钮 → 引擎选择）时面板保持展开
  function onFocusOut(event: FocusEvent & { currentTarget: HTMLFormElement }) {
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
    const option = optionAt(event.target);
    if (option) activate(option);
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<form
  class="search"
  role="search"
  action={ENGINES[engine].action}
  target="_blank"
  rel="noopener noreferrer"
  onsubmit={onSubmit}
  onfocusin={onFocusIn}
  onfocusout={onFocusOut}
>
  <label class="caption" for={inputId}>搜索</label>
  <div class="field">
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
      id={inputId}
      type="text"
      name={ENGINES[engine].param}
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open && navigated ? activeId : undefined}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="search"
      placeholder={hint}
    />
    {#if query !== ''}
      <button class="clear" type="button" aria-label="清空" onmousedown={(event) => event.preventDefault()} onclick={clear}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </button>
    {/if}
  </div>
  <div class="tail">
    <!-- 点它直接用搜索引擎搜输入的内容；mousedown 阻止默认行为，焦点不离开输入框。
         不做成提交按钮：表单里第一个提交按钮会被回车当成提交者，回车就该打开高亮项 -->
    <button
      class="engine"
      type="button"
      aria-label={`用 ${ENGINES[engine].name} 搜索`}
      onmousedown={(event) => event.preventDefault()}
      onclick={onEngineClick}>{ENGINES[engine].name}</button
    >
    <kbd class="hotkey" aria-hidden="true">/</kbd>
  </div>

  <!-- 键盘操作都在输入框上（combobox 模式），列表只处理指针：mousedown 阻止默认行为，点击时焦点不离开输入框 -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="panel"
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
      <div class="group" role="group" aria-label="网站">
        <p class="group-label" aria-hidden="true">网站</p>
        {#each siteOptions as option (option.key)}
          <SearchRow {option} id={rowId(option)} active={option.key === active} />
        {/each}
      </div>
    {/if}
    <div class="group" role="group" aria-label={`用 ${ENGINES[engine].name} 搜索`}>
      <p class="group-label" aria-hidden="true">用 {ENGINES[engine].name} 搜索</p>
      {#each searchOptions as option (option.key)}
        <SearchRow {option} id={rowId(option)} active={option.key === active} />
      {/each}
    </div>
  </div>
  <p class="visually-hidden" role="status">{status}</p>
</form>

<style>
  /* 自身定位并高于后面的卡片（卡片各自是层叠上下文），展开面板才能盖在它们上面。
     一行四样：仿宋「搜索」、输入框、墨底斜体的搜索引擎签、快捷键提示 */
  .search {
    position: relative;
    z-index: var(--z-popover);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    column-gap: 0.75rem;
    align-items: center;
    inline-size: 100%;
  }

  .caption {
    font: var(--text-base) / 1 var(--label);
    letter-spacing: 0.3em;
    cursor: text;
  }

  .field {
    position: relative;
    min-inline-size: 0;
  }

  /* 16px：iOS 在字号小于 16px 的输入框聚焦时会放大页面 */
  input {
    display: block;
    inline-size: 100%;
    padding: 0.6875rem 0.875rem;
    font-size: 1rem;
    text-overflow: ellipsis;
    background: var(--paper);
    border: 1px solid var(--ink);
    border-radius: 0;
    appearance: none;
  }

  input:not(:placeholder-shown) {
    padding-inline-end: 2.5rem;
  }

  /* 聚焦：输入框底边一道樱花色笔线从左描出，代替焦点框 */
  input:focus-visible {
    outline: none;
  }

  .field::after {
    content: '';
    position: absolute;
    inset: auto 0 0;
    block-size: 2px;
    pointer-events: none;
    background: var(--sakura-deep);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform var(--dur-draw) var(--ease-out);
  }

  .field:focus-within::after {
    transform: none;
  }

  /* 清空：输入框右端的一个小叉，有内容时才出现 */
  .clear {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0.375rem;
    display: grid;
    place-items: center;
    inline-size: 1.75rem;
    block-size: 1.75rem;
    margin-block: auto;
    padding: 0;
    color: var(--ink-3);
    background: none;
    border: 0;
  }

  .clear:hover {
    color: var(--ink);
  }

  .clear svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
  }

  .tail {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  /* 搜索引擎签：墨底斜体的名字，点它就用这个引擎搜；换引擎在设置页 */
  .engine {
    padding: 0.3125rem 0.5625rem;
    font: italic var(--text-sm) / 1 var(--serif);
    color: var(--paper);
    white-space: nowrap;
    cursor: pointer;
    background: var(--ink);
    border: 0;
    border-radius: 0;
    transition:
      translate var(--dur-hover) var(--spring),
      box-shadow var(--dur-hover) var(--ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .engine:active {
    translate: 0 1px;
  }

  /* 悬停：底下一道樱花色笔线，和输入框聚焦时的那道一样；墨底白字不变，对比度不受影响 */
  @media (hover: hover) {
    .engine:hover {
      box-shadow: 0 2px 0 var(--sakura-deep);
    }
  }

  /* 快捷键提示只给有键盘的宽屏 */
  .hotkey {
    display: grid;
    place-items: center;
    inline-size: 1.375rem;
    block-size: 1.375rem;
    font: var(--text-xs) / 1 var(--serif);
    color: var(--ink-2);
    border: var(--rule-thin);
  }

  @media (width <= 48rem), (pointer: coarse) {
    .hotkey {
      display: none;
    }
  }

  /* 面板：宽屏对齐输入框那一栏，手机铺满整行。从输入框下沿往下展开（clip-path），同时淡入、下落 6px；
     收起反向、更快。hidden 切换 display，配合 @starting-style 做进场 */
  .panel {
    position: absolute;
    inset-block-start: calc(100% + 0.5rem);
    inset-inline: 0;
    grid-column: 2;
    max-block-size: min(34rem, 70dvh);
    padding: 0.375rem 0.5rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    background: var(--surface);
    border: var(--rule-thin);
    box-shadow: var(--lift);
    clip-path: inset(-40px);
    transition:
      opacity var(--dur-open) var(--ease-out),
      translate var(--dur-open) var(--ease-out),
      clip-path var(--dur-open) var(--ease-out),
      display var(--dur-open) allow-discrete;
  }

  .panel[hidden] {
    display: none;
    pointer-events: none;
    opacity: 0;
    translate: 0 -6px;
    clip-path: inset(0 0 100% 0);
    transition-duration: var(--dur-close);
  }

  @starting-style {
    .panel {
      opacity: 0;
      translate: 0 -6px;
      clip-path: inset(0 0 100% 0);
    }
  }

  @media (width <= 48rem) {
    .panel {
      grid-column: 1 / -1;
    }
  }
  /* 分组：像版块的栏目名，仿宋小字 + 一道细线；两组之间再隔一道细线 */
  .group + .group {
    margin-block-start: 0.375rem;
    border-block-start: var(--rule-thin);
  }

  .group-label {
    padding: 0.5rem 0.5rem 0.375rem;
    font: var(--text-xs) / 1.3 var(--label);
    letter-spacing: 0.2em;
    color: var(--ink-3);
  }
</style>
