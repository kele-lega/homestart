import { isComposing } from '../lib/keyboard';
import { formatClock } from '../widgets/clock/format';
import { isForward, neighbor, routeOf, SUB_PAGES, titleOf, type InkRoute, type SubPage } from './pages';
import { greeting, shichen } from './text';

/**
 * 留白的站内切换。/、/cal、/dir、/play、/site 服务端渲染的是同一份文档（只是 hidden 不同），
 * 这里接管站内链接（[data-go]）：history.pushState 换地址，显示对应的那一页，配上 View Transitions：
 *   墨晕  首页 → 子页   新页面像一滴墨从点的地方晕开，印章从入口飞到页眉
 *   卷轴  子页 ↔ 子页   一根画轴扫过去，新页面随轴展开，方向跟着前后
 *   收墨  子页 → 首页   整页化成墨，再收成一滴落回它的入口
 * 不支持 View Transitions 或要求减少动效时直接切换。链接都是真地址：脚本没加载、按住 Ctrl/⌘ 点、中键点，都照常打开。
 *
 * 换页时 <html data-route> 跟着变，并在 window 上发 ink:route（detail 是页面名）：
 * 游艺第一次翻到才取 Steam，跋只在看着时连计数推送、取服务器状态。
 * 还管几件全页的小事：快捷键、首页分类、图标加载失败换成首字母、题款里的时辰和问候、墨迹遮罩预先画成位图
 */

const root = document.documentElement;
const shell = document.querySelector<HTMLElement>('.ink');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const siteTitle = shell?.dataset.siteTitle ?? document.title;
const VT_CLASSES = ['vt-ink', 'vt-ret', 'vt-scroll', 'vt-f', 'vt-b', 'vt-seal-src'];

let route: InkRoute = routeOf(location.pathname) ?? 'home';

const pageOf = (name: InkRoute) => document.querySelector<HTMLElement>(`.page[data-page="${name}"]`);

function show(next: InkRoute): void {
  for (const page of document.querySelectorAll<HTMLElement>('.page[data-page]')) page.hidden = page.dataset.page !== next;
  route = next;
  root.dataset.route = next;
  document.title = titleOf(next, siteTitle);
  scrollTo({ top: 0, behavior: 'instant' });
  dispatchEvent(new CustomEvent('ink:route', { detail: next }));
}

/* 印章：转场时让出发处和到达处的印章共用一个 view-transition-name，浏览器把它从一处搬到另一处 */
function sealOf(side: 'home' | 'sub', page: SubPage): HTMLElement | null {
  return side === 'home'
    ? document.querySelector<HTMLElement>(`.ent[data-go="${page}"] .seal`)
    : document.querySelector<HTMLElement>(`.ph [data-seal="${page}"]`);
}

function nameSeal(node: HTMLElement | null): void {
  for (const named of document.querySelectorAll('.vts')) named.classList.remove('vts');
  node?.classList.add('vts');
}

function centerOf(node: HTMLElement | null): readonly [number, number] {
  if (!node) return [innerWidth / 2, innerHeight / 2];
  const box = node.getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2];
}

function setXY([x, y]: readonly [number, number]): void {
  root.style.setProperty('--x', `${x}px`);
  root.style.setProperty('--y', `${y}px`);
}

interface GoOptions {
  /** 墨从哪里晕开；键盘、程序触发时从入口的印章 */
  readonly point?: readonly [number, number] | undefined;
  /** 浏览器前进后退：不再 pushState */
  readonly pop?: boolean;
  /** 地址（可带查询串，例如 /cal?date=…）；不给就是页面的路径 */
  readonly href?: string | undefined;
  /** 新页面换上之后要做的事（在转场的截图之前） */
  readonly after?: (() => void) | undefined;
}

let running: ViewTransition | undefined;

function go(to: InkRoute, { point, pop = false, href, after }: GoOptions = {}): void {
  if (!pop) {
    const target = href ?? (to === 'home' ? '/' : `/${to}`);
    if (target !== location.pathname + location.search) history.pushState(null, '', target);
  }
  if (to === route) {
    after?.();
    return;
  }
  const from = route;
  for (const open of document.querySelectorAll<HTMLElement>('.pop:popover-open')) open.hidePopover();
  if (!('startViewTransition' in document) || reduced.matches) {
    show(to);
    after?.();
    return;
  }
  running?.skipTransition();
  const kind = from === 'home' ? 'ink' : to === 'home' ? 'ret' : 'scroll';
  const forward = from !== 'home' && to !== 'home' ? isForward(from, to) : true;
  root.classList.remove(...VT_CLASSES);
  root.classList.add(`vt-${kind}`, forward ? 'vt-f' : 'vt-b', 'vt-seal-src');
  // 出发处的印章，以及墨从哪里晕开
  if (kind === 'ink' && to !== 'home') {
    nameSeal(sealOf('home', to));
    setXY(point ?? centerOf(sealOf('home', to)));
  } else if (from !== 'home') {
    nameSeal(sealOf('sub', from));
  }
  let extra: HTMLElement | undefined;
  const transition = document.startViewTransition(() => {
    show(to);
    // 到达处的印章；收墨时墨点落回它的入口
    if (kind === 'ret' && from !== 'home') {
      nameSeal(sealOf('home', from));
      setXY(centerOf(sealOf('home', from)));
    } else if (to !== 'home') {
      nameSeal(sealOf('sub', to));
    }
    extra = document.createElement('div');
    extra.className = kind === 'scroll' ? 'rod' : `wash ${kind}`;
    extra.setAttribute('aria-hidden', 'true');
    document.body.append(extra);
    after?.();
  });
  running = transition;
  void transition.finished.finally(() => {
    extra?.remove();
    if (running !== transition) return;
    root.classList.remove(...VT_CLASSES);
    nameSeal(null);
    running = undefined;
  });
}

/** 首页条幅带着日期（/cal?date=…）：翻到月令后让月历选中那天 */
function pickFrom(href: string): (() => void) | undefined {
  const date = new URL(href, location.href).searchParams.get('date');
  return date ? () => dispatchEvent(new CustomEvent('ink:pick', { detail: date })) : undefined;
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-go]') : null;
  const to = link && routeOf(new URL(link.href).pathname);
  if (!link || !to) return;
  event.preventDefault();
  const url = new URL(link.href);
  // detail 是点击次数：0 表示键盘回车触发的，墨从入口的印章晕开
  go(to, {
    point: event.detail > 0 ? [event.clientX, event.clientY] : undefined,
    href: url.pathname + url.search,
    after: pickFrom(link.href),
  });
});

addEventListener('popstate', () => {
  const to = routeOf(location.pathname) ?? 'home';
  go(to, { pop: true, after: pickFrom(location.href) });
});

/* ================= 首页分类 ================= */
const CAT_KEY = 'home:ink-cat';
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.cat[data-cat]')];

function showCat(tab: HTMLButtonElement, focus = false): void {
  const id = tab.dataset.cat ?? '';
  for (const other of tabs()) {
    const on = other === tab;
    other.setAttribute('aria-selected', String(on));
    other.tabIndex = on ? 0 : -1;
  }
  for (const panel of document.querySelectorAll<HTMLElement>('.links[data-cat]')) panel.hidden = panel.dataset.cat !== id;
  if (focus) tab.focus();
  try {
    localStorage.setItem(CAT_KEY, id);
  } catch {
    // 存不下：这次照样切换
  }
}

function stepCat(delta: 1 | -1): void {
  const list = tabs();
  if (list.length === 0) return;
  const index = list.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const next = list[(index + delta + list.length) % list.length]!;
  showCat(next, list.includes(document.activeElement as HTMLButtonElement));
}

document.addEventListener('click', (event) => {
  const tab = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.cat[data-cat]') : null;
  if (tab) showCat(tab);
});

/* ================= 快捷键 ================= */
const searchInput = () => document.querySelector<HTMLInputElement>('#ink-q');

function typingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** 弹窗（告示、建议、日程编辑框）开着时，快捷键都不抢 */
const dialogOpen = () => document.querySelector('dialog[open]') !== null;

function typeIntoSearch(text: string): void {
  const input = searchInput();
  if (!input) return;
  input.focus();
  if (text) {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

addEventListener('keydown', (event) => {
  if (event.key === 'Alt') root.classList.add('keys');
  if (event.defaultPrevented || isComposing(event) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (typingIn(event.target) || dialogOpen()) return;
  const { key } = event;

  if (key === 'Escape') {
    if (document.querySelector('.pop:popover-open')) return;
    if (route !== 'home') go('home');
    return;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const delta = key === 'ArrowRight' ? 1 : -1;
    event.preventDefault();
    if (route === 'home') stepCat(delta);
    else go(neighbor(route, delta));
    return;
  }
  if (route === 'home' && /^[1-8]$/.test(key)) {
    document.querySelector<HTMLAnchorElement>(`.fav[data-fav="${key}"]`)?.click();
    return;
  }
  if (!searchInput()) return;
  if (key === '/') {
    event.preventDefault();
    if (route === 'home') typeIntoSearch('');
    else go('home', { after: () => typeIntoSearch('') });
    return;
  }
  // 直接打字就是搜索：首页上焦点挪进输入框，这个字自己会落进去；子页先回首页再填上
  if (key.length === 1 && !event.shiftKey && !/\s/.test(key)) {
    if (route === 'home') {
      searchInput()?.focus();
    } else {
      event.preventDefault();
      go('home', { after: () => typeIntoSearch(key) });
    }
  }
});

/* ================= 滚轮翻页 ================= */
/*
 * 五页排成一列：首页 → 月令 → 目录 → 游艺 → 跋，往下滚翻到后一页，往上滚回前一页（到头就停，不绕回去）。
 * 一次「手势」只翻一页：滚轮连着转、触控板松手后的惯性，事件之间都隔不到 250ms，算同一次。
 * 页面本身还能往那个方向滚的时候先滚页面；滚到底的那一下不翻页，停一停再滚才翻，免得滚过头一下子翻走
 */
const WHEEL_ORDER: readonly InkRoute[] = ['home', ...SUB_PAGES];
const GESTURE_GAP = 250;
const FLIP_AT = 40;
/** 浏览器在另一个线程上先滚、后把滚轮事件交给脚本：攒够了等这么久，看这次手势里页面到底滚没滚过 */
const SETTLE = 80;

let wheelAt = -Infinity;
let gestureStart = -Infinity;
let wheelSpent = false;
let wheelSum = 0;
let scrolledAt = -Infinity;

document.addEventListener(
  'scroll',
  (event) => {
    scrolledAt = event.timeStamp;
  },
  { capture: true, passive: true },
);

/** 从 node 往上，有没有哪一层还能往 down 的方向滚 */
function canScroll(node: EventTarget | null, down: boolean): boolean {
  for (let el = node instanceof Element ? node : null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1 || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
    if (down ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
  }
  const page = document.scrollingElement ?? root;
  return down ? page.scrollTop + innerHeight < page.scrollHeight - 1 : page.scrollTop > 0;
}

/** 这次滚轮不该翻页：缩放、弹窗开着、滚在输入框或下拉候选上、首页正在搜索 */
function wheelBlocked(event: WheelEvent): boolean {
  if (event.ctrlKey || event.defaultPrevented || dialogOpen() || document.querySelector(':popover-open')) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [role="listbox"]')) return true;
  return route === 'home' && (searchInput()?.value ?? '') !== '';
}

addEventListener(
  'wheel',
  (event) => {
    const now = event.timeStamp;
    if (now - wheelAt > GESTURE_GAP) {
      wheelSpent = false;
      wheelSum = 0;
      gestureStart = now;
    }
    wheelAt = now;
    // 横着滑交给浏览器（触控板左右滑是前进后退）
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || wheelBlocked(event)) {
      wheelSpent = true;
      return;
    }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    const delta = event.deltaY * unit;
    if (delta === 0) return;
    if (canScroll(event.target, delta > 0)) {
      wheelSpent = true;
      return;
    }
    if (wheelSpent) return;
    // 方向反了就重新攒
    if (Math.sign(delta) !== Math.sign(wheelSum)) wheelSum = 0;
    wheelSum += delta;
    if (Math.abs(wheelSum) < FLIP_AT) return;
    wheelSpent = true;
    const from = route;
    const next = WHEEL_ORDER[WHEEL_ORDER.indexOf(route) + (wheelSum > 0 ? 1 : -1)];
    if (!next) return;
    // 滚到底的那一下：事件到这里时页面已经滚到了头，看上去「滚不动了」，其实这一下是在滚页面，不翻
    setTimeout(() => {
      if (scrolledAt < gestureStart && route === from) go(next);
    }, SETTLE);
  },
  { passive: true },
);

/* ================= 子页：点空白处回首页 ================= */
/*
 * 只认鼠标单击在「纯排版的空地」上：页面本身、分栏的格子之类自己不带字的容器。
 * 点到字、链接、按钮、输入框都不算；正在选字、刚关掉弹出的小纸、刚从输入框点出来（只是想让它失焦）也不算。
 * 手机上不做：手指点空白多半是想滚动或者点偏了
 */
const LAYOUT_TAGS = /^(SECTION|DIV|MAIN|HEADER|FOOTER|NAV|ASIDE|UL|OL|DL)$/;
const INTERACTIVE =
  'a, button, input, textarea, select, label, summary, details, dialog, [role="button"], [role="tab"], [tabindex], [contenteditable], .pop';

let pressedOnBlank = false;

function hasOwnText(el: Element): boolean {
  for (const child of el.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) return true;
  return false;
}

function isBlank(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || !target.closest('.page[data-page]:not(.home)')) return false;
  return LAYOUT_TAGS.test(target.tagName) && !hasOwnText(target) && !target.closest(INTERACTIVE);
}

document.addEventListener(
  'pointerdown',
  (event) => {
    pressedOnBlank =
      route !== 'home' &&
      event.pointerType === 'mouse' &&
      event.button === 0 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      !typingIn(document.activeElement) &&
      !dialogOpen() &&
      !document.querySelector(':popover-open') &&
      isBlank(event.target);
  },
  true,
);

document.addEventListener('click', (event) => {
  const pressed = pressedOnBlank;
  pressedOnBlank = false;
  if (!pressed || event.defaultPrevented || event.detail !== 1 || !isBlank(event.target)) return;
  if (!(getSelection()?.isCollapsed ?? true)) return;
  go('home');
});

addEventListener('keyup', (event) => {
  if (event.key === 'Alt') root.classList.remove('keys');
});
addEventListener('blur', () => root.classList.remove('keys'));

/* ================= 图标：加载失败换成首字母 ================= */
function letterFor(img: HTMLImageElement): void {
  const name = img.dataset.n ?? '';
  const sibling = img.dataset.variant
    ? img.parentElement?.querySelector<HTMLImageElement>(`img.ico[data-n][data-variant]:not([data-variant="${img.dataset.variant}"])`)
    : null;
  // 有另一种明暗的版本还能用：只留那一张，不分明暗都显示它
  if (sibling && !sibling.dataset.failed) {
    img.dataset.failed = '';
    img.remove();
    delete sibling.dataset.variant;
    return;
  }
  sibling?.remove();
  const letter = document.createElement('span');
  letter.className = 'ico letter';
  letter.setAttribute('aria-hidden', 'true');
  letter.textContent = Array.from(name.trim())[0]?.toUpperCase() ?? '·';
  img.replaceWith(letter);
}

addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.classList.contains('ico') && img.dataset.n !== undefined) letterFor(img);
  },
  true,
);
// 脚本到之前就已经失败的
for (const img of document.querySelectorAll<HTMLImageElement>('img.ico[data-n]')) {
  if (img.complete && img.naturalWidth === 0 && img.currentSrc) letterFor(img);
}

/* ================= 题款：时辰、问候 ================= */
const sealEl = document.querySelector<HTMLElement>('[data-shichen]');
const greetEl = document.querySelector<HTMLElement>('[data-greeting]');
const clockLink = document.querySelector<HTMLElement>('.clock[data-clock]');
const timeZone = shell?.dataset.timezone ?? 'Asia/Shanghai';
let minuteTimer: ReturnType<typeof setTimeout> | undefined;

function tickHour(): void {
  const now = new Date();
  const { hours, minutes } = formatClock(now, timeZone, root.lang || 'zh-CN');
  const hour = Number(hours);
  const name = shichen(hour);
  if (sealEl && sealEl.textContent?.trim() !== name) {
    sealEl.textContent = name;
    sealEl.setAttribute('aria-label', `现在是${name}`);
  }
  const hello = greeting(hour);
  if (greetEl && greetEl.textContent !== hello) greetEl.textContent = hello;
  clockLink?.setAttribute('aria-label', `${hours}:${minutes}，打开月令`);
  clearTimeout(minuteTimer);
  minuteTimer = setTimeout(tickHour, 60_000 - (now.getTime() % 60_000) + 50);
}

tickHour();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tickHour();
});

/* ================= 墨迹遮罩预先画成位图 ================= */
/*
 * CSS 里的墨迹是一张带湍流滤镜的 SVG，转场时尺寸每帧都在变，SVG 每帧都要在 CPU 上重新栅格化一遍滤镜。
 * 空闲时把它画成一张 720px 的 PNG，之后转场只是缩放一张位图
 */
async function bakeBlot(): Promise<void> {
  const match = getComputedStyle(root)
    .getPropertyValue('--blot')
    .trim()
    .match(/^url\("?(.*?)"?\)$/);
  if (!match?.[1]) return;
  const image = new Image();
  image.src = match[1];
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.filter = 'blur(1.2px)';
  context.drawImage(image, 0, 0, 720, 720);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  if (blob) root.style.setProperty('--blot', `url(${URL.createObjectURL(blob)})`);
}

if ('startViewTransition' in document && !reduced.matches) {
  const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200));
  requestAnimationFrame(() => setTimeout(() => idle(() => void bakeBlot().catch(() => undefined))));
}

// 服务端按地址渲染了对应的页面；这里只补上 <html data-route>（从缓存恢复等情况下可能对不上）
if (pageOf(route)?.hidden) show(route);
else root.dataset.route = route;
