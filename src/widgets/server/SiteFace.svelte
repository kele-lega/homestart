<script lang="ts">
  /**
   * 「本站」那一面，所有人都看得到：一个翻页计数器（导航和搜索合在一起算），下面是提交建议，管理员再多一排工具。
   * 页面上每有一次导航或搜索（见 ./hits），先在本页加一、再报给服务端；别人的点击经 /api/site/stream 实时推过来，
   * 推送连不上时每 15 秒轮询一次。几处来的数取较大的那个，不会往回翻。
   * 牌面怎么一格一格翻过去、页面在后台时攒着切回来再翻，见 FlipCounter。
   * 提建议要先填图片验证码：开始写的时候才去领题，每次提交（不管成没成）之后都换一张
   */
  import { untrack } from 'svelte';
  import { COMPOSE_EVENT } from '../../lib/announcements';
  import { bump, fetchCounts, mergeCounts, readCounts, reportHit, SITE_STREAM_URL, type SiteCounts } from '../../lib/site-stats';
  import { fetchCaptcha, submitSuggestion, SUGGESTION_LIMITS, type Captcha } from '../../lib/suggestions';
  import FlipCounter from './FlipCounter.svelte';
  import { hitOf } from './hits';
  import Suggestions from './Suggestions.svelte';

  interface Props {
    counts: SiteCounts;
    /** 站内登录了才能提交建议 */
    signedIn: boolean;
    admin: boolean;
    /** 管理员：还没处理的建议条数 */
    pending: number;
    timeZone: string;
    /** 「提建议」「管理」小标题的级别：比栏目头低一级 */
    level: number;
  }

  let { counts: initial, signedIn, admin, pending: initialPending, timeZone, level }: Props = $props();

  const uid = $props.id();
  /** 实时推送连不上时退回轮询的间隔 */
  const POLL_MS = 15_000;

  /** 已知的最新计数；牌面什么时候、怎么翻过去由 FlipCounter 管 */
  let counts = $state(untrack(() => initial));
  let pending = $state(untrack(() => initialPending));
  let suggestions = $state<Suggestions>();

  let draft = $state('');
  let captcha = $state<Captcha | undefined>(undefined);
  let answer = $state('');
  let loadingCaptcha = $state(false);
  let busy = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);

  let stream: EventSource | undefined;
  /** 推送被拒（403 / 503）或浏览器不支持：这一页改成轮询 */
  let polling = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  function learn(next: SiteCounts | undefined): void {
    if (next) counts = mergeCounts(counts, next);
  }

  function onHit(event: MouseEvent): void {
    const kind = hitOf(event);
    if (!kind) return;
    // 先在本页加一，马上开始翻；服务端的回执和推送晚到时取较大的，不会翻回去
    counts = bump(counts, kind);
    void reportHit(kind).then(learn);
  }

  /** 连上推送：连上先收到一次当前计数，之后别人点一下这里就跟着翻。断线浏览器自己重连 */
  function connect(): void {
    if (stream || polling) return;
    if (typeof EventSource !== 'function') {
      startPolling();
      return;
    }
    const source = new EventSource(SITE_STREAM_URL);
    stream = source;
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        learn(readCounts(JSON.parse(event.data)));
      } catch {
        // 读不懂的一条跳过
      }
    };
    source.onerror = () => {
      // 网络抖动时 readyState 是 CONNECTING，浏览器会自己重连；CLOSED 是被拒了，不再重连
      if (source.readyState !== EventSource.CLOSED) return;
      disconnect();
      startPolling();
    };
  }

  function disconnect(): void {
    stream?.close();
    stream = undefined;
  }

  function startPolling(): void {
    polling = true;
    void refresh();
  }

  async function refresh(): Promise<void> {
    clearTimeout(poll);
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const next = await fetchCounts(current.signal);
    if (current.signal.aborted) return;
    learn(next);
    if (document.visibilityState === 'visible') poll = setTimeout(() => void refresh(), POLL_MS);
  }

  // 看不见的时候断开，省得后台标签页一直占着连接；切回来重新连上，连上那一刻就拿到最新的数
  function onVisibility(): void {
    if (document.visibilityState === 'visible') {
      if (polling) void refresh();
      else connect();
    } else {
      disconnect();
      clearTimeout(poll);
      controller?.abort();
    }
  }

  $effect(() => {
    document.addEventListener('click', onHit);
    document.addEventListener('auxclick', onHit);
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') connect();
    return () => {
      document.removeEventListener('click', onHit);
      document.removeEventListener('auxclick', onHit);
      document.removeEventListener('visibilitychange', onVisibility);
      disconnect();
      clearTimeout(poll);
      controller?.abort();
    };
  });

  const CAPTCHA_LENGTH = 4;

  async function loadCaptcha(): Promise<void> {
    if (loadingCaptcha) return;
    loadingCaptcha = true;
    answer = '';
    const result = await fetchCaptcha();
    loadingCaptcha = false;
    if (result.ok) captcha = result.captcha;
    else notice = { kind: 'error', text: result.message };
  }

  /** 第一次点进表单时才领题：只看不写的人不用去服务端拿图 */
  function onFormFocus(): void {
    if (!captcha) void loadCaptcha();
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (draft.trim() === '' || !captcha || answer.trim().length < CAPTCHA_LENGTH) return;
    busy = true;
    notice = undefined;
    const result = await submitSuggestion(draft, captcha.id, answer);
    busy = false;
    // 这道题服务端已经作废了：成功就等下次再领，失败马上换一张
    captcha = undefined;
    answer = '';
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      void loadCaptcha();
      return;
    }
    draft = '';
    notice = { kind: 'ok', text: '收到了，谢谢你的建议' };
    if (admin) pending += 1;
  }

  /** 管理员的工具：以后再加功能就在这里多一项 */
  const tools = $derived([
    {
      key: 'suggestions',
      label: '查看建议',
      badge: pending,
      run: () => void suggestions?.open(),
    },
    {
      key: 'announce',
      label: '发布公告',
      badge: 0,
      run: () => dispatchEvent(new Event(COMPOSE_EVENT)),
    },
  ]);
</script>

<div class="site">
  <!-- 服务端分开记导航和搜索，牌面上只显示两者之和 -->
  <dl class="tally">
    <dt>导航与搜索</dt>
    <dd><FlipCounter value={counts.nav + counts.search} digits={7} label="导航与搜索" /></dd>
  </dl>

  <section class="block" aria-labelledby={`${uid}-suggest`}>
    <svelte:element this={`h${level}`} class="block-title" id={`${uid}-suggest`}>提建议</svelte:element>
    {#if signedIn}
      <form class="suggest" onsubmit={onSubmit} onfocusin={onFormFocus}>
        <label class="field">
          <span class="visually-hidden">你的建议</span>
          <textarea
            bind:value={draft}
            name="suggestion"
            rows="2"
            maxlength={SUGGESTION_LIMITS.body}
            placeholder="想要什么功能、哪里不好用，都可以写在这里"
          ></textarea>
        </label>
        <div class="captcha">
          <label class="field captcha-field">
            <span class="visually-hidden">验证码</span>
            <input
              bind:value={answer}
              name="captcha"
              inputmode="numeric"
              autocomplete="off"
              maxlength={CAPTCHA_LENGTH}
              placeholder="验证码"
            />
          </label>
          {#if captcha}
            <img class="captcha-image" src={captcha.image} alt="验证码图片：请把图里的 4 个数字填进左边的框" width="140" height="48" />
          {:else}
            <span class="captcha-image captcha-empty" aria-hidden="true">{loadingCaptcha ? '取图中…' : ''}</span>
          {/if}
          <button type="button" class="text-btn" disabled={loadingCaptcha || busy} onclick={() => void loadCaptcha()}>换一张</button>
        </div>
        <div class="suggest-row">
          {#if notice}
            <p class="notice" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
          {:else}
            <span class="count" aria-hidden="true">{draft.length} / {SUGGESTION_LIMITS.body}</span>
          {/if}
          <button type="submit" class="send" disabled={busy || draft.trim() === '' || !captcha || answer.trim().length < CAPTCHA_LENGTH}>{busy ? '正在提交…' : '提交'}</button>
        </div>
      </form>
    {:else}
      <p class="hint"><a href="/login">登录后提交建议</a></p>
    {/if}
  </section>

  {#if admin}
    <section class="block" aria-labelledby={`${uid}-tools`}>
      <svelte:element this={`h${level}`} class="block-title" id={`${uid}-tools`}>管理</svelte:element>
      <ul class="tools" role="list">
        {#each tools as tool (tool.key)}
          <li>
            <button type="button" class="tool" aria-haspopup="dialog" onclick={tool.run}>
              <span>{tool.label}</span>
              {#if tool.badge > 0}<span class="badge">{tool.badge}<span class="visually-hidden"> 条未处理</span></span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>
    <Suggestions bind:this={suggestions} {timeZone} onpending={(count) => (pending = count)} />
  {/if}
</div>

<style>
  .site {
    display: grid;
    gap: 1.25rem;
  }

  /* 一个计数器，牌面大小跟着版块宽度走 */
  .tally {
    --flip-size: clamp(2rem, 10cqi, 3.25rem);

    display: grid;
    gap: 0.375rem;
  }

  .tally dt {
    font: 700 var(--text-sm) / 1.4 var(--label);
    letter-spacing: 0.15em;
    color: var(--ink-2);
  }

  .block {
    display: grid;
    gap: 0.5rem;
    padding-block-start: 0.875rem;
    border-block-start: var(--rule-thin);
  }

  .block-title {
    font: 700 var(--text-sm) / 1.4 var(--label);
    letter-spacing: 0.15em;
    color: var(--ink-2);
  }

  .suggest {
    display: grid;
    gap: 0.5rem;
  }

  /* 和登录页一样的下划线输入框，聚焦时樱色的线从左边画过去 */
  .field {
    position: relative;
    display: grid;
  }

  .field::after {
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

  .field:focus-within::after {
    transform: none;
  }

  textarea {
    inline-size: 100%;
    padding: 0.25rem 0;
    font: var(--text-base) / 1.6 var(--font-body);
    color: var(--ink);
    resize: vertical;
    background: none;
    border: 0;
    border-block-end: 1px solid var(--ink-3);
    border-radius: 0;
  }

  /* 验证码：一条短的下划线输入框，右边是图和「换一张」 */
  .captcha {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .captcha-field {
    inline-size: 6rem;
  }

  input {
    inline-size: 100%;
    padding: 0.25rem 0;
    font: var(--text-base) / 1.6 var(--num);
    letter-spacing: 0.2em;
    color: var(--ink);
    background: none;
    border: 0;
    border-block-end: 1px solid var(--ink-3);
    border-radius: 0;
  }

  input:focus-visible {
    outline: none;
  }

  .captcha-image {
    display: grid;
    place-items: center;
    inline-size: 140px;
    block-size: 48px;
    border: var(--rule-thin);
  }

  .captcha-empty {
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--ink-3);
  }

  .text-btn {
    padding: 0.25rem 0;
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--blue);
    background: none;
    border: 0;
  }

  .text-btn:disabled {
    cursor: default;
    opacity: 0.45;
  }

  textarea::placeholder,
  input::placeholder {
    color: var(--ink-3);
  }

  textarea:focus-visible {
    outline: none;
  }

  .suggest-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .count,
  .hint,
  .notice {
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--ink-3);
  }

  .count {
    font-family: var(--num);
  }

  .notice[data-kind='ok'] {
    color: var(--blue);
  }

  .notice[data-kind='error'] {
    font: var(--text-sm) / 1.5 var(--pen);
    color: var(--red);
  }

  .hint a {
    color: var(--blue);
  }

  .send {
    flex: none;
    margin-inline-start: auto;
    padding: 0.25rem 1rem;
    font: var(--text-sm) / 1.5 var(--label);
    letter-spacing: 0.12em;
    color: var(--paper);
    background: var(--ink);
    border: 1px solid var(--ink);
  }

  .send:disabled {
    cursor: default;
    opacity: 0.45;
  }

  /* 管理工具：和服务器入口一样的索引签，左边一道粗墨线 */
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0;
    list-style: none;
  }

  .tool {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-block-size: 2.25rem;
    padding: 0.25rem 0.75rem 0.25rem 0.875rem;
    font: 700 var(--text-sm) / 1.2 var(--label);
    letter-spacing: 0.08em;
    color: var(--ink);
    background: none;
    border: var(--rule-thin);
    border-inline-start: 3px solid var(--ink);
    isolation: isolate;
    -webkit-tap-highlight-color: transparent;
  }

  .tool::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: var(--sakura-wash);
    opacity: 0;
    transition: opacity var(--dur-hover) var(--ease-out);
  }

  .tool:active::before,
  .tool:focus-visible::before {
    opacity: 1;
  }

  .tool:focus-visible {
    outline-offset: -2px;
  }

  .badge {
    min-inline-size: 1.25rem;
    padding: 0 0.3rem;
    font: 700 var(--text-2xs) / 1.25rem var(--num);
    color: var(--paper);
    text-align: center;
    background: var(--red);
    border-radius: 0.625rem;
  }

  @media (hover: hover) {
    .tool:hover::before {
      opacity: 1;
    }

    .send:not(:disabled):hover {
      background: var(--ink-2);
    }
  }
</style>
