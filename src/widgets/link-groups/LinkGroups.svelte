<!--
  分类导航：每个分类一个按钮，控制一块链接面板。
  宽屏：面板向下弹出，按卡片位置朝放得下的一侧展开。鼠标停留预览，点击或焦点进入面板时固定；
  点开里面的网站、Esc、点击别处或 Tab 离开时收起。
  窄屏：一行一张分类标签，点按在标签下方展开，各组互不影响。
  展开状态由 menu.ts 的纯函数计算，这里只把事件接进去。
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import SiteIcon from '../../components/SiteIcon.svelte';
  import { WIDE_QUERY } from '../../lib/breakpoints';
  import { isComposing } from '../../lib/keyboard';
  import { alignPanel, type Align } from './align';
  import type { LinkGroup } from './groups';
  import { CLOSED, hold, pin, preview, relayout, toggle, unpreview, type MenuState } from './menu';

  interface Props {
    id: string;
    groups: readonly LinkGroup[];
  }

  let { id, groups }: Props = $props();

  // 悬停意图：停一下才打开，离开后稍等再关，鼠标斜着移到面板上时不会闪
  const OPEN_DELAY = 120;
  const CLOSE_DELAY = 180;
  const STACK_SIZE = 3;

  let menu = $state.raw<MenuState>(CLOSED);
  // 每组面板朝哪边展开，打开前按卡片位置算好；收起后保留，淡出时不会换边
  let aligns = $state.raw<Readonly<Record<string, Align>>>({});
  let wide = $state(false);
  let nav = $state<HTMLElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const panelId = (group: LinkGroup) => `${id}_${group.id}_panel`;
  const isOpen = (group: LinkGroup) => menu.open.includes(group.id);
  // 只有鼠标悬停才预览；触摸和触控笔的点按走 click
  const isMouse = (event: PointerEvent) => event.pointerType === 'mouse';
  // 分类 id 已由配置校验为 [a-z][a-z0-9-]*，可以直接放进选择器
  const itemOf = (groupId: string) => nav?.querySelector<HTMLElement>(`[data-group="${groupId}"]`);

  function schedule(next: () => MenuState, delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      menu = next();
    }, delay);
  }

  function close() {
    clearTimeout(timer);
    menu = CLOSED;
  }

  // 焦点所在的分类（焦点在它的按钮或面板里）
  function focusedGroup(): string | undefined {
    const active = document.activeElement;
    const item = active instanceof Element ? active.closest<HTMLElement>('[data-group]') : null;
    return item && nav?.contains(item) ? item.dataset.group : undefined;
  }

  // 宽屏下重新决定展开中那一组的面板朝哪边
  function remeasure() {
    const openId = menu.open[0];
    if (wide && openId !== undefined) measure(openId);
  }

  onMount(() => {
    const query = matchMedia(WIDE_QUERY);
    const sync = () => {
      wide = query.matches;
      clearTimeout(timer);
      menu = relayout(menu, focusedGroup(), wide);
      remeasure();
    };
    // 固定展开时改变窗口宽度，卡片可能换行，面板要重新选边
    const resize = new ResizeObserver(remeasure);
    sync();
    query.addEventListener('change', sync);
    if (nav) resize.observe(nav);
    return () => {
      query.removeEventListener('change', sync);
      resize.disconnect();
      clearTimeout(timer);
    };
  });

  function measure(groupId: string) {
    const item = itemOf(groupId);
    const panel = item?.querySelector<HTMLElement>('.panel');
    if (!item || !panel || !nav) return;
    const align = alignPanel(item.getBoundingClientRect(), nav.getBoundingClientRect(), panel.offsetWidth);
    if (aligns[groupId] !== align) aligns = { ...aligns, [groupId]: align };
  }

  function onPointerEnter(event: PointerEvent, group: LinkGroup) {
    if (!wide || !isMouse(event)) return;
    if (isOpen(group)) {
      clearTimeout(timer);
      return;
    }
    measure(group.id);
    schedule(() => preview(menu, group.id), OPEN_DELAY);
  }

  function onPointerLeave(event: PointerEvent) {
    if (!wide || !isMouse(event)) return;
    schedule(() => unpreview(menu), CLOSE_DELAY);
  }

  function onChipClick(group: LinkGroup) {
    // 先取消还没触发的悬停预览，免得双击固定又取消后被它重新打开
    clearTimeout(timer);
    if (wide) measure(group.id);
    menu = wide ? pin(menu, group.id) : toggle(menu, group.id);
  }

  // 焦点进入正在预览的面板（点了里面的链接，或用 Tab 进去）时固定住，鼠标移开也不收起
  function onFocusIn(event: FocusEvent, group: LinkGroup) {
    if (wide && event.target instanceof Element && event.target.closest('.panel')) menu = hold(menu, group.id);
  }

  // 展开的这一组失去焦点、焦点去了组外（键盘 Tab 离开）时收起；焦点离开窗口（relatedTarget 为空，
  // 比如新标签页打开了链接）时保持。没展开的组与此无关：之前点过的按钮还留着焦点，
  // 点另一组预览里的链接时它先触发 focusout，不能因此把那一组收起
  function onFocusOut(event: FocusEvent, group: LinkGroup) {
    const next = event.relatedTarget;
    const item = event.currentTarget as HTMLElement;
    if (wide && isOpen(group) && next instanceof Node && !item.contains(next)) close();
  }

  // 宽屏下点开面板里的网站后收起；焦点原本在链接上（键盘回车）时还给分类按钮，不落进收起的面板。
  // 按着修饰键点（在后台连开几个）时保持展开
  function onLinkClick(event: MouseEvent, group: LinkGroup) {
    if (!wide || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const item = itemOf(group.id);
    const hadFocus = item?.contains(document.activeElement) ?? false;
    close();
    if (hadFocus) item?.querySelector('button')?.focus({ preventScroll: true });
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (!wide || menu.open.length === 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-group]') || !nav?.contains(target)) close();
  }

  // Esc 收起（也取消还在等待的悬停预览）；焦点原本在这一组里时还给它的按钮，焦点在别处（比如搜索框）时不抢。
  // 输入法组合中的 Esc、已被别处处理过的 Esc（比如搜索框先收起联想）不算
  function onWindowKeydown(event: KeyboardEvent) {
    if (!wide || event.key !== 'Escape' || event.defaultPrevented || isComposing(event)) return;
    clearTimeout(timer);
    const openId = menu.open[0];
    if (openId === undefined) return;
    const item = itemOf(openId);
    const hadFocus = item?.contains(document.activeElement) ?? false;
    close();
    if (hadFocus) item?.querySelector('button')?.focus();
  }
</script>

<!-- 点击别处收起用捕获阶段，别处的 stopPropagation 挡不住 -->
<svelte:window onpointerdowncapture={onWindowPointerDown} onkeydown={onWindowKeydown} />

<nav class="link-groups" aria-label="网站分类" bind:this={nav}>
  <ul class="groups">
    {#each groups as group (group.id)}
      {@const open = isOpen(group)}
      <li
        class="group"
        data-group={group.id}
        data-tone={group.tone}
        data-open={open || undefined}
        data-pinned={(open && menu.pinned) || undefined}
        data-align={aligns[group.id] ?? 'start'}
        onpointerenter={(event) => onPointerEnter(event, group)}
        onpointerleave={onPointerLeave}
        onfocusin={(event) => onFocusIn(event, group)}
        onfocusout={(event) => onFocusOut(event, group)}
      >
        <button
          type="button"
          class="chip"
          aria-expanded={open}
          aria-controls={panelId(group)}
          onclick={() => onChipClick(group)}
        >
          <span class="hole" aria-hidden="true"></span>
          <span class="name">{group.name}</span>
          <span class="count">{group.links.length} 个网站</span>
          <span class="stack" aria-hidden="true">
            {#each group.links.slice(0, STACK_SIZE) as link}
              <SiteIcon name={link.name} icon={link.icon} iconDark={link.iconDark} size="xs" />
            {/each}
          </span>
        </button>
        <!-- 收起即 inert：淡出的那一小段时间里，面板既不能被 Tab 进去，也不算鼠标停在这一组上。
             .fold 只在窄屏起作用：它是被行高过渡裁剪的那一层，自己不带边框和内边距，0fr 时才能真正收成 0 -->
        <div class="panel" id={panelId(group)} inert={!open}>
          <div class="fold">
            <ul class="links">
              {#each group.links as link}
                <li>
                  <a class="link petal-row" href={link.url} target="_blank" rel="noopener noreferrer" data-visit onclick={(event) => onLinkClick(event, group)}>
                    <SiteIcon name={link.name} icon={link.icon} iconDark={link.iconDark} size="xs" />
                    <span class="label">{link.name}</span>
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .groups,
  .links {
    padding: 0;
    list-style: none;
  }

  .groups {
    display: grid;
    gap: 0.625rem;
  }

  .group {
    position: relative;
  }

  /*
   * 分类签子：顶边一道 4px 的色调，左边打一个孔，像活页夹里的索引签。
   * 底色是色调混进纸色的淡色；展开时加深的那一层放在伪元素上，只过渡 opacity
   */
  /*
   * 文字一栏先按内容排开，图标摞只拿剩下的宽度；否则图标多的签子会把「3 个网站」挤成几行，
   * 同一排的签子高矮不一。签子撑满所在的格子，同一排始终等高
   */
  .chip {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    row-gap: 0.125rem;
    column-gap: 0.75rem;
    align-items: center;
    inline-size: 100%;
    block-size: 100%;
    padding: 0.8125rem 0.875rem 0.75rem 2.25rem;
    text-align: start;
    background: color-mix(in srgb, var(--tone) 7%, var(--paper));
    border: var(--rule-thin);
    border-block-start: 4px solid var(--tone);
    border-radius: 0;
    isolation: isolate;
    transition: translate var(--dur-hover) var(--spring);
    -webkit-tap-highlight-color: transparent;
  }

  .chip::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: color-mix(in srgb, var(--tone) 16%, var(--paper));
    opacity: 0;
    transition: opacity var(--dur-hover) var(--ease-out);
  }

  /* 签子左边的孔，透出底下书桌的颜色 */
  .hole {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 0.8125rem;
    inline-size: 0.6875rem;
    block-size: 0.6875rem;
    background: var(--desk);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--rule);
    translate: 0 -50%;
  }

  /* 点击固定后孔里多一颗同色调的圆点，和只是悬停预览区分开 */
  .hole::after {
    content: '';
    position: absolute;
    inset: 0.1875rem;
    background: var(--tone);
    border-radius: 50%;
    scale: 0;
    transition: scale var(--dur-hover) var(--spring);
  }

  [data-pinned] .hole::after {
    scale: 1;
  }

  .name {
    min-inline-size: 0;
    overflow: hidden;
    font-size: var(--text-lg);
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: 0.12em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .count {
    min-inline-size: 0;
    overflow: hidden;
    font: var(--text-xs) / 1.3 var(--label);
    color: var(--ink-2);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* 前三个网站的图标靠右并排，跨两行；放不下的图标折到第二行被裁掉，不会挤文字 */
  .stack {
    display: flex;
    flex-wrap: wrap;
    grid-area: 1 / 2 / 3 / 3;
    justify-content: flex-end;
    gap: 0.25rem;
    block-size: 1.375rem;
    overflow: hidden;
  }

  .chip:focus-visible,
  [data-open] > .chip {
    translate: 0 -3px;
  }

  /* 展开时底色加深；触屏按下时也闪一下，当作点按反馈 */
  .chip:active::before,
  [data-open] > .chip::before {
    opacity: 1;
  }

  @media (hover: hover) {
    .chip:hover {
      translate: 0 -3px;
    }
  }

  /* 面板本身：细线框，顶边一道和签子同色的色调 */
  .links {
    padding: 0.375rem 0.5rem;
    background: var(--surface);
    border: var(--rule-thin);
    border-block-start: 4px solid var(--tone);
  }

  /* 链接行和搜索结果同一套高亮（base.css 的 .petal-row）：悬停、键盘焦点、按下时亮起 */
  .link {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-block-size: 2.5rem;
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
    font-size: var(--text-sm);
    font-weight: 700;
    -webkit-tap-highlight-color: transparent;
  }

  li + li > .link {
    border-block-start: var(--rule-thin);
  }

  /* 面板会滚动或裁剪，焦点框画在内侧 */
  .link:focus-visible {
    outline-offset: -2px;
  }

  .link:focus-visible,
  .link:active {
    --lit: 1;
  }

  @media (hover: hover) {
    .link:hover {
      --lit: 1;
    }
  }

  .label {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 宽屏：签子排成一行，面板从签子下方弹出，盖在下面的内容之上（分类导航在页头下面，往上弹会挡住搜索框） */
  @media (width > 48rem) {
    .groups {
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: 1.25rem;
    }

    /*
     * 收起时用 visibility 隐藏而不是 display: none：打开前要量面板宽度，决定朝哪边展开。
     * 展开：从签子那一边往下揭开（clip-path），同时淡入、下移 6px 落到位；收起更快
     */
    .panel {
      position: absolute;
      inset-block-start: calc(100% + 0.75rem);
      inset-inline-start: 0;
      z-index: var(--z-popover);
      inline-size: max(100%, 17rem);
      visibility: hidden;
      opacity: 0;
      translate: 0 -6px;
      clip-path: inset(0 0 100% 0);
      transition:
        opacity var(--dur-close) var(--ease-out),
        translate var(--dur-close) var(--ease-out),
        clip-path var(--dur-close) var(--ease-out),
        visibility 0s linear var(--dur-close);
    }

    [data-align='end'] > .panel {
      inset-inline: auto 0;
    }

    /* 揭开后往外多留 40px，阴影不会被裁掉 */
    [data-open] > .panel {
      visibility: visible;
      opacity: 1;
      translate: none;
      clip-path: inset(-40px);
      transition-duration: var(--dur-open), var(--dur-open), var(--dur-open), 0s;
      transition-delay: 0s;
    }

    /* 面板和签子之间的空隙也算在面板里，鼠标斜着移上去不会触发离开 */
    .panel::after {
      content: '';
      position: absolute;
      inset-inline: 0;
      inset-block-end: 100%;
      block-size: calc(0.75rem + 4px);
    }

    .links {
      max-block-size: min(22rem, 60dvh);
      overflow-y: auto;
      overscroll-behavior: contain;
      box-shadow: var(--lift);
    }
  }

  /* 窄屏：一行一个签子，点按在下方展开，各组互不影响（与可折叠区域同样的行高过渡） */
  @media (width <= 48rem) {
    /* 签子和面板之间的 8px 是第一条轨道，跟着同一个 grid-template-rows 过渡 */
    .panel {
      display: grid;
      grid-template-rows: 0rem 0fr;
      visibility: hidden;
      transition:
        grid-template-rows var(--dur-close) var(--ease-out),
        visibility 0s linear var(--dur-close);
    }

    [data-open] > .panel {
      grid-template-rows: 0.5rem 1fr;
      visibility: visible;
      transition-duration: var(--dur-open), 0s;
      transition-delay: 0s;
    }

    /* 被裁剪的这一层不带边框和内边距；面板随展开淡入并轻轻落下 */
    .fold {
      grid-row: 2;
      min-block-size: 0;
      overflow: hidden;
      opacity: 0;
      translate: 0 -6px;
      transition:
        opacity var(--dur-close) var(--ease-out),
        translate var(--dur-close) var(--ease-out);
    }

    [data-open] .fold {
      opacity: 1;
      translate: none;
      transition-duration: var(--dur-open);
    }

    .link {
      min-block-size: 2.75rem;
    }
  }
</style>
