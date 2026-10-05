<!--
  浮起来的一张纸（<dialog> 模态），后面整页虚化：公告、建议这类弹窗共用的外壳。
  点虚化的地方、按 Esc、点右上角的叉都会关上；关的时候先播完收起的动画再真的关。
  里面的列表、按钮、输入框也在这里统一画（见样式后半段），各个弹窗只写自己的内容
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CROSS } from '../lib/icons';

  interface Props {
    title: string;
    /** 标题的 id，dialog 的 aria-labelledby 指向它 */
    labelId: string;
    /** 标题右边、叉左边的按钮，例如「写一条」 */
    actions?: Snippet;
    children: Snippet;
    /** 真的关上以后 */
    onclose?: () => void;
  }

  let { title, labelId, actions, children, onclose }: Props = $props();

  // 收起动画 220ms；animationend 一直没来（标签页在后台、机器太慢之类）时，最多等这么久也关上
  const CLOSE_FALLBACK_MS = 700;

  let dialog = $state<HTMLDialogElement>();
  let paper = $state<HTMLElement>();
  let closing = $state(false);
  // 按下的位置也在虚化的地方才算点了外面：在纸上拖选文字、松手落到外面不会关上
  let pressedOutside = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;

  /** 已经开着时返回 false */
  export function open(): boolean {
    if (!dialog || dialog.open) return false;
    closing = false;
    // 页面的滚动条藏起来时让出的宽度，补成 body 的右内边距（见样式）
    const root = document.documentElement;
    root.style.setProperty('--scrollbar-gap', `${innerWidth - root.clientWidth}px`);
    dialog.showModal();
    return true;
  }

  export function isOpen(): boolean {
    return dialog?.open ?? false;
  }

  export function close(): void {
    if (!dialog?.open || closing) return;
    closing = true;
    clearTimeout(fallback);
    fallback = setTimeout(finishClose, CLOSE_FALLBACK_MS);
  }

  /** 焦点所在的按钮被删掉时，落回纸上 */
  export function focusPaper(): void {
    paper?.focus();
  }

  function finishClose(): void {
    clearTimeout(fallback);
    if (dialog?.open) dialog.close();
  }

  function onClosed(): void {
    closing = false;
    onclose?.();
  }

  // Esc：浏览器默认会立刻关掉，换成先播收起的动画
  function onCancel(event: Event): void {
    event.preventDefault();
    close();
  }

  function onAnimationEnd(event: AnimationEvent): void {
    if (closing && event.target === dialog) finishClose();
  }

  // <dialog> 本身只有纸那么大（没有内边距），点在它自己身上就是点在纸外面的虚化处（::backdrop）
  function onPointerDown(event: PointerEvent): void {
    pressedOutside = event.target === dialog;
  }

  function onClick(event: MouseEvent): void {
    if (pressedOutside && event.target === dialog) close();
    pressedOutside = false;
  }
</script>

<!-- 键盘用 Esc 关（cancel 事件），点击只是给鼠标和触屏的「点外面关上」 -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  class="paper-dialog"
  aria-labelledby={labelId}
  data-closing={closing ? '' : undefined}
  oncancel={onCancel}
  onclose={onClosed}
  onanimationend={onAnimationEnd}
  onpointerdown={onPointerDown}
  onclick={onClick}
>
  <section class="paper" bind:this={paper} tabindex="-1">
    <header class="head">
      <h2 class="title" id={labelId}>{title}</h2>
      {@render actions?.()}
      <button type="button" class="close" aria-label="关闭" onclick={close}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          {#each CROSS as d (d)}<path {d} />{/each}
        </svg>
      </button>
    </header>
    {@render children()}
  </section>
</dialog>

<style>
  /*
   * <dialog> 本身透明、没有内边距，正好是纸那么大：点在它自己身上就是点在纸外面的虚化处。
   * 打开时纸从下面浮上来、从略小放到正常，后面整页模糊并压暗一点；关上时反着来，更快。
   * ::backdrop 要到较新的浏览器才继承页面上的变量，时长和颜色直接写数，两处保持一致
   */
  .paper-dialog {
    inline-size: min(36rem, calc(100vw - 2rem));
    max-inline-size: none;
    max-block-size: none;
    margin: auto;
    padding: 0;
    color: var(--ink);
    background: none;
    border: 0;
    overflow: visible;
  }

  .paper-dialog::backdrop {
    background: rgb(12 16 32 / 0.26);
    -webkit-backdrop-filter: blur(8px) saturate(1.1);
    backdrop-filter: blur(8px) saturate(1.1);
  }

  .paper-dialog[open] {
    animation: sheet-in 340ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .paper-dialog[open]::backdrop {
    animation: veil-in 340ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .paper-dialog[data-closing] {
    animation: sheet-out 220ms cubic-bezier(0.65, 0, 0.35, 1) forwards;
  }

  .paper-dialog[data-closing]::backdrop {
    animation: veil-out 220ms cubic-bezier(0.65, 0, 0.35, 1) forwards;
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      translate: 0 1.5rem;
      scale: 0.96;
    }
  }

  @keyframes sheet-out {
    to {
      opacity: 0;
      translate: 0 0.75rem;
      scale: 0.97;
    }
  }

  @keyframes veil-in {
    from {
      opacity: 0;
    }
  }

  @keyframes veil-out {
    to {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .paper-dialog::backdrop {
      animation-duration: 0.01ms !important;
    }
  }

  /*
   * 开着时后面的页面不滚。滚动条藏起来让出的那条宽度补成 body 的右内边距：版面不往右跳，
   * 而且那一条也是页面的一部分，虚化照样盖满整个窗口（scrollbar-gutter 留出的槽不在 ::backdrop 底下）
   */
  :global(html:has(dialog.paper-dialog[open])) {
    overflow: hidden;
  }

  :global(html:has(dialog.paper-dialog[open]) body) {
    padding-inline-end: var(--scrollbar-gap, 0px);
  }

  /* 纸：和版块一样，顶上一道粗线；标题行贴在顶上，内容长了在纸里面滚。不叫 .sheet：那是整页纸的全局类名 */
  .paper {
    display: flex;
    flex-direction: column;
    max-block-size: min(40rem, calc(100dvh - 3rem));
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    background: var(--surface);
    border: var(--rule-thin);
    border-block-start: var(--rule-heavy);
    box-shadow:
      0 24px 60px -24px light-dark(rgb(29 39 56 / 0.45), rgb(0 0 0 / 0.75)),
      var(--lift);
  }

  .paper:focus-visible {
    outline: none;
  }

  .head {
    position: sticky;
    inset-block-start: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3) var(--space-6);
    background: var(--surface);
    border-block-end: var(--rule-thin);
  }

  .title {
    flex: 1;
    font: 700 var(--text-2xl) / 1.3 var(--font-body);
    letter-spacing: 0.2em;
  }

  .close {
    display: grid;
    place-items: center;
    inline-size: 2rem;
    block-size: 2rem;
    padding: 0;
    color: var(--ink-3);
    background: none;
    border: 0;
    border-radius: 50%;
    transition:
      color var(--dur-hover) var(--ease-out),
      background-color var(--dur-hover) var(--ease-out);
  }

  .close svg {
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  @media (hover: hover) {
    .close:hover {
      color: var(--ink);
      background: var(--sakura-wash);
    }
  }

  /* —— 以下是各个弹窗内容共用的样子，只在纸里面生效 —— */

  .paper :global(.notice),
  .paper :global(.empty) {
    margin: var(--space-4) var(--space-6) 0;
    font: var(--text-sm) / 1.6 var(--label);
    color: var(--ink-3);
  }

  .paper :global(.empty) {
    margin-block: var(--space-8);
    text-align: center;
  }

  .paper :global(.notice[data-kind='ok']) {
    color: var(--blue);
  }

  .paper :global(.notice[data-kind='error']) {
    font: var(--text-base) / 1.6 var(--pen);
    color: var(--red);
  }

  /* 一条一条往下排，之间一道细线：日期和发布人一行小字，标题，正文照原样换行 */
  .paper :global(.list) {
    margin: 0;
    padding: 0 var(--space-6);
    list-style: none;
  }

  .paper :global(.item) {
    display: grid;
    gap: var(--space-1);
    padding-block: var(--space-4);
  }

  .paper :global(.item + .item) {
    border-block-start: var(--rule-thin);
  }

  .paper :global(.meta) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    font: var(--text-xs) / 1.5 var(--num);
    color: var(--ink-3);
  }

  .paper :global(.item-title) {
    font: 700 var(--text-lg) / 1.5 var(--font-body);
    overflow-wrap: anywhere;
  }

  .paper :global(.body) {
    font: var(--text-base) / 1.75 var(--font-body);
    color: var(--ink-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .paper :global(.item-actions) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-block-start: var(--space-1);
  }

  .paper :global(.confirm-text) {
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .paper :global(.text-btn) {
    padding: 0;
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--blue);
    background: none;
    border: 0;
  }

  .paper :global(.text-btn[data-kind='danger']) {
    color: var(--red);
  }

  .paper :global(.text-btn:disabled) {
    cursor: default;
    opacity: 0.5;
  }

  @media (hover: hover) {
    .paper :global(.text-btn:not(:disabled):hover) {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }

  /* 表单：和登录页一样的下划线输入框，聚焦时樱色的线从左边画过去 */
  .paper :global(.compose) {
    display: grid;
    gap: var(--space-4);
    margin: var(--space-4) var(--space-6) 0;
    padding-block-end: var(--space-4);
    border-block-end: var(--rule-thin);
  }

  .paper :global(.field) {
    position: relative;
    display: grid;
    gap: var(--space-1);
  }

  .paper :global(.field::after) {
    position: absolute;
    inset: auto 0 0;
    block-size: 2px;
    pointer-events: none;
    content: '';
    background: var(--sakura-deep);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform var(--dur-draw) var(--ease-out);
  }

  .paper :global(.field:focus-within::after) {
    transform: none;
  }

  .paper :global(.field-label) {
    font: var(--text-xs) / 1.5 var(--label);
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }

  .paper :global(.input) {
    inline-size: 100%;
    padding: var(--space-1) 0;
    font: var(--text-lg) / 1.6 var(--font-body);
    color: var(--ink);
    resize: vertical;
    background: none;
    border: 0;
    border-block-end: 1px solid var(--ink-3);
    border-radius: 0;
  }

  .paper :global(.input:focus-visible) {
    outline: none;
  }

  .paper :global(.actions) {
    display: flex;
    gap: var(--space-3);
  }

  .paper :global(.btn) {
    padding: 0.375rem 1.125rem;
    font: var(--text-sm) / 1.5 var(--label);
    letter-spacing: 0.12em;
    color: var(--ink);
    background: none;
    border: 1px solid var(--ink-2);
  }

  .paper :global(.btn[data-kind='primary']) {
    color: var(--paper);
    background: var(--ink);
    border-color: var(--ink);
  }

  .paper :global(.btn:disabled) {
    cursor: default;
    opacity: 0.55;
  }

  @media (width <= 48rem) {
    .head {
      padding-inline-start: var(--space-4);
    }

    .paper :global(.list) {
      padding-inline: var(--space-4);
    }

    .paper :global(.compose),
    .paper :global(.notice) {
      margin-inline: var(--space-4);
    }
  }
</style>
