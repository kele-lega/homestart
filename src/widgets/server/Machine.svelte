<script lang="ts">
  /**
   * 「服务器」那一面（只给管理员）：三个圆环（CPU、内存、存储）和一排服务入口。挂载时读一次，翻到这一面时每 5 秒取一次，
   * 翻回去、页面切到后台时停下，翻过来、切回来立即补一次。悬停、键盘聚焦或触屏点按时，格子上方弹出详细说明，Esc 收起
   */
  import { jsonHeaders } from '../../lib/widget-api';
  import { readServerView, STATS_URL } from './client';
  import type { ServerView } from './present';
  import type { ServerEntry } from './widget';

  interface Props {
    entries: readonly ServerEntry[];
    /** 正翻在这一面：只有这时才轮询 */
    active: boolean;
    /** 栏目头右边的说明（已运行多久 / 暂时连不上），交给 Panel 画 */
    sub?: string | undefined;
  }

  let { entries, active, sub = $bindable() }: Props = $props();

  const uid = $props.id();
  const POLL_MS = 5_000;
  /** 第一次读数回来之前，圆环位置先画空的轨道 */
  const PLACEHOLDER = ['CPU', '内存', '存储'];

  let view = $state<ServerView | undefined>(undefined);
  let failed = $state(false);
  /** 触屏点开的那一格；鼠标靠悬停，不记 */
  let pinned = $state<string | undefined>(undefined);
  /** 按了 Esc：指针移到别处或焦点换了之前，说明都不弹出 */
  let hushed = $state(false);

  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 指针下面是哪一格；换格子时解除 Esc */
  let hovered: string | undefined;

  async function refresh(): Promise<void> {
    clearTimeout(timer);
    controller?.abort();
    const current = new AbortController();
    controller = current;
    let status = 0;
    try {
      const response = await fetch(STATS_URL, { headers: jsonHeaders('GET'), signal: current.signal });
      status = response.status;
      const data = readServerView(await response.json());
      if (current.signal.aborted) return;
      if (data) view = data;
      failed = data === undefined;
    } catch {
      if (current.signal.aborted) return;
      failed = true;
    }
    // 403 是登录过期或不再是管理员，不再轮询；页面切回来时再试一次
    if (status !== 403 && active && document.visibilityState === 'visible') timer = setTimeout(() => void refresh(), POLL_MS);
  }
  function onVisibility(): void {
    if (document.visibilityState === 'visible') void refresh();
    else {
      clearTimeout(timer);
      controller?.abort();
    }
  }

  // 挂载时先读一次，翻过来时圆环已经是真实读数；之后只在翻到这一面时轮询
  let primed = false;
  $effect(() => {
    if (!active) {
      if (!primed) void refresh();
      primed = true;
      return;
    }
    primed = true;
    void refresh();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer);
      controller?.abort();
    };
  });

  /** 格子的 key 写在 data-cell 上；指针换了格子就解除 Esc */
  function cellOf(target: EventTarget | null): string | undefined {
    return target instanceof Element ? (target.closest<HTMLElement>('[data-cell]')?.dataset.cell ?? undefined) : undefined;
  }

  function onPointerOver(event: PointerEvent): void {
    const cell = cellOf(event.target);
    if (cell !== hovered) hushed = false;
    hovered = cell;
  }

  // 点到别处就收起触屏点开的那一格
  function onPointerDown(event: PointerEvent): void {
    if (pinned !== undefined && cellOf(event.target) !== pinned) pinned = undefined;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    pinned = undefined;
    hushed = true;
  }

  function onFocusIn(): void {
    hushed = false;
  }

  // 鼠标点按靠悬停就够了；触屏和键盘的「点按」切换这一格的说明
  function toggle(event: MouseEvent, cell: string): void {
    if ((event as PointerEvent).pointerType === 'mouse') return;
    pinned = pinned === cell ? undefined : cell;
  }

  function hostOf(url: string): string {
    return new URL(url).host;
  }

  $effect(() => {
    sub = failed ? (view ? '暂时连不上' : undefined) : view?.uptime;
  });
  const align = (index: number, count: number) => (index === 0 ? 'start' : index === count - 1 ? 'end' : 'center');
</script>

<svelte:window onpointerover={onPointerOver} onpointerdown={onPointerDown} onkeydown={onKeydown} onfocusin={onFocusIn} />

<div class="machine" data-hushed={hushed ? '' : undefined}>
  {#if view}
      <ul class="gauges" role="list" data-stale={failed ? '' : undefined}>
        {#each view.gauges as gauge, index (gauge.key)}
          {@const cell = `g-${gauge.key}`}
          <li class="cell" data-cell={cell} data-open={pinned === cell ? '' : undefined} data-align={align(index, 3)} data-level={gauge.level}>
            <button type="button" class="dial" aria-describedby={`${uid}-${cell}`} onclick={(event) => toggle(event, cell)}>
              <span class="face">
                <svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
                  <circle class="track" cx="20" cy="20" r="17" pathLength="100" />
                  <circle class="arc" cx="20" cy="20" r="17" pathLength="100" style:stroke-dashoffset={100 - gauge.percent} />
                </svg>
                <span class="pct" aria-hidden="true">{gauge.percent}<span class="pct-unit">%</span></span>
              </span>
              <span class="label">{gauge.label}<span class="visually-hidden"> {gauge.percent}%</span></span>
            </button>
            <div class="tip" role="tooltip" id={`${uid}-${cell}`}>
              <p class="tip-head">{gauge.summary}</p>
              <dl class="tip-list">
                {#each gauge.details as detail (detail.term)}
                  <div><dt>{detail.term}</dt><dd>{detail.value}</dd></div>
                {/each}
              </dl>
            </div>
          </li>
        {/each}
      </ul>
    {:else if failed}
      <p class="feed-notice" data-kind="error">
        服务器状态没有取到
        <button type="button" class="sv-retry" onclick={() => void refresh()}>重试</button>
      </p>
    {:else}
      <ul class="gauges" role="list" aria-hidden="true">
        {#each PLACEHOLDER as label (label)}
          <li class="cell">
            <span class="dial">
              <span class="face">
                <svg class="ring" viewBox="0 0 40 40"><circle class="track" cx="20" cy="20" r="17" /></svg>
              </span>
              <span class="label">{label}</span>
            </span>
          </li>
        {/each}
      </ul>
      <span class="visually-hidden">服务器状态加载中</span>
  {/if}

  {#if entries.length > 0}
    <ul class="doors" role="list" style:--doors={entries.length}>
      {#each entries as entry, index}
        {@const cell = `e-${index}`}
        <li class="cell" data-cell={cell} data-align={align(index, entries.length)}>
          <a class="door" href={entry.url} target="_blank" rel="noopener noreferrer" aria-describedby={`${uid}-${cell}`}>
            <span class="door-name">{entry.name}</span>
            <span class="door-arrow" aria-hidden="true">↗&#xFE0E;</span>
          </a>
          <div class="tip" role="tooltip" id={`${uid}-${cell}`}>
            {#if entry.description}<p class="tip-head">{entry.description}</p>{/if}
            <p class="tip-host">{hostOf(entry.url)}</p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /*
   * 上面一排三个仪表：细线轨道上一段墨色的弧，数字写在圈里，名称在下面；用得多了弧变琥珀色、红色。
   * 下面一排入口是带粗书脊的细线框，像索引签。每一格的详细说明是一张浮起的小卡片，从格子上方弹出，
   * 第一格靠左、最后一格靠右对齐，不会伸出版块
   */
  .machine {
    display: grid;
    gap: 1.125rem;
  }

  .gauges,
  .doors {
    display: grid;
    padding: 0;
    list-style: none;
  }

  .gauges {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .doors {
    grid-template-columns: repeat(var(--doors), minmax(0, 1fr));
    gap: 0.75rem;
  }

  .cell {
    --level: var(--ink);

    position: relative;
    display: grid;
  }

  .cell[data-level='high'] {
    --level: var(--t3);
  }

  .cell[data-level='full'] {
    --level: var(--red);
  }

  /* 仪表本身不做任何事，只是悬停 / 聚焦 / 点按说明的落点，指针保持默认 */
  .dial {
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    color: inherit;
    cursor: default;
    background: none;
    border: 0;
  }

  /* 圆环随版块宽度缩放，窄到四十几像素也放得下「100%」 */
  .face {
    --face: clamp(3.25rem, 26cqi, 4.75rem);

    display: grid;
    place-items: center;
    inline-size: var(--face);
    block-size: var(--face);
    transition: translate var(--dur-hover) var(--spring);
  }

  .ring,
  .pct {
    grid-area: 1 / 1;
  }

  /* 从 12 点钟方向起笔，顺时针画 */
  .ring {
    inline-size: 100%;
    block-size: 100%;
    overflow: visible;
    rotate: -90deg;
  }

  .ring circle {
    fill: none;
  }

  .track {
    stroke: var(--rule);
    stroke-width: 1.25;
  }

  /* pathLength=100：dashoffset 就是「还差多少」 */
  .arc {
    stroke: var(--level);
    stroke-width: 3;
    stroke-dasharray: 100;
    transition:
      stroke-dashoffset var(--dur-open) var(--ease-out),
      stroke var(--dur-hover) linear;
  }

  .pct {
    font: 400 calc(var(--face) * 0.32) / 1 var(--serif);
    color: var(--level);
    font-variant-numeric: tabular-nums;
    transition: color var(--dur-hover) linear;
  }

  .pct-unit {
    margin-inline-start: 0.05em;
    font-size: 0.5em;
    color: var(--ink-3);
  }

  /* 名称下面的樱色短线，和常用网站一样悬停时从左往右画出来 */
  .label {
    position: relative;
    padding-block-end: 0.25rem;
    font-size: var(--text-sm);
    font-weight: 700;
    letter-spacing: 0.15em;
    padding-inline-start: 0.15em;
  }

  .label::after {
    content: '';
    position: absolute;
    inset: auto 0 0;
    block-size: 2px;
    background: var(--sakura-deep);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform var(--dur-hover) var(--ease-out);
  }

  .dial:focus-visible {
    outline-offset: -2px;
  }

  .gauges[data-stale] .face {
    opacity: 0.45;
  }

  /* 入口：细线框，左边一道粗墨线当书脊；悬停时铺淡樱色，箭头往右上挪一点 */
  .door {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-block-size: 2.75rem;
    padding: 0.5rem 0.75rem 0.5rem 0.875rem;
    border: var(--rule-thin);
    border-inline-start: 3px solid var(--ink);
    isolation: isolate;
    -webkit-tap-highlight-color: transparent;
  }

  .door::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: var(--sakura-wash);
    opacity: 0;
    transition: opacity var(--dur-hover) var(--ease-out);
  }

  .door:focus-visible {
    outline-offset: -2px;
  }

  .door-name {
    min-inline-size: 0;
    overflow: hidden;
    font: 700 var(--text-base) / 1.2 var(--mono);
    letter-spacing: 0.02em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .door-arrow {
    flex: none;
    font-size: var(--text-sm);
    color: var(--ink-3);
    transition:
      translate var(--dur-hover) var(--spring),
      color var(--dur-hover) linear;
  }

  .door:active::before,
  .door:focus-visible::before {
    opacity: 1;
  }

  .door:focus-visible .door-arrow {
    color: var(--sakura-deep);
    translate: 2px -2px;
  }

  .dial:focus-visible .face {
    translate: 0 -2px;
  }

  .dial:focus-visible .label::after,
  .cell[data-open] .label::after {
    transform: none;
  }

  @media (hover: hover) {
    .door:hover::before {
      opacity: 1;
    }

    .door:hover .door-arrow {
      color: var(--sakura-deep);
      translate: 2px -2px;
    }

    .dial:hover .face {
      translate: 0 -2px;
    }

    .dial:hover .label::after {
      transform: none;
    }
  }

  /*
   * 说明卡片：收起时 visibility 隐藏（读屏仍能经 aria-describedby 读到），弹出时淡入、上移 4px。
   * 不超过版块宽度；顶边一道和圆环同色的线
   */
  .tip {
    position: absolute;
    inset-block-end: calc(100% + 0.5rem);
    z-index: var(--z-popover);
    inline-size: max-content;
    max-inline-size: min(16rem, 100cqi);
    padding: 0.5rem 0.75rem 0.5625rem;
    text-align: start;
    background: var(--surface);
    border: var(--rule-thin);
    border-block-start: 3px solid var(--level);
    box-shadow: var(--lift);
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    translate: var(--tip-x, 0) 4px;
    transition:
      opacity var(--dur-close) var(--ease-out),
      translate var(--dur-close) var(--ease-out),
      visibility 0s linear var(--dur-close);
  }

  /* 卡片和格子之间的空隙也算在卡片里，鼠标移上去读长型号时不会收起 */
  .tip::after {
    content: '';
    position: absolute;
    inset-inline: 0;
    inset-block-start: 100%;
    block-size: calc(0.5rem + 1px);
  }

  .cell[data-align='start'] > .tip {
    inset-inline-start: 0;
  }

  .cell[data-align='end'] > .tip {
    inset-inline-end: 0;
  }

  .cell[data-align='center'] > .tip {
    --tip-x: -50%;

    inset-inline-start: 50%;
  }

  /*
   * 什么时候弹出：触屏点开的、键盘聚焦的，有鼠标的设备上还有悬停的。
   * 写在 :where 里不占优先级，下面按了 Esc 的 data-hushed 总能压过它们
   */
  :where(.cell[data-open], .cell:has(:focus-visible)) > .tip {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    translate: var(--tip-x, 0) 0;
    transition-duration: var(--dur-open), var(--dur-open), 0s;
    transition-delay: 0s;
  }

  @media (hover: hover) {
    :where(.cell:hover) > .tip {
      visibility: visible;
      opacity: 1;
      pointer-events: auto;
      translate: var(--tip-x, 0) 0;
      transition-duration: var(--dur-open), var(--dur-open), 0s;
      transition-delay: 0s;
    }
  }

  .machine[data-hushed] .tip {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .tip-head {
    font: 700 var(--text-sm) / 1.4 var(--num);
    white-space: nowrap;
  }

  /* 名目一列、读数一列，各行共用列宽 */
  .tip-list {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 0.75rem;
    row-gap: 0.125rem;
    margin-block-start: 0.375rem;
    padding-block-start: 0.375rem;
    border-block-start: var(--rule-thin);
  }

  .tip-list > div {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
  }

  .tip-list dt {
    font: var(--text-xs) / 1.6 var(--label);
    color: var(--ink-3);
  }

  .tip-list dd {
    font: var(--text-xs) / 1.6 var(--num);
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }

  .tip-host {
    font: var(--text-xs) / 1.5 var(--mono);
    color: var(--ink-3);
    white-space: nowrap;
  }

  .tip-head + .tip-host {
    margin-block-start: 0.125rem;
  }

  .sv-retry {
    margin-inline-start: 0.375rem;
    padding: 0;
    font: inherit;
    color: var(--blue);
    background: none;
    border: 0;
  }

  @media (hover: hover) {
    .sv-retry:hover {
      text-decoration: underline;
    }
  }
</style>
