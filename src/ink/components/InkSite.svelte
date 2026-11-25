<script lang="ts">
  /**
   * 跋：本站替大家导航、搜索了多少次，和留言（提建议）。所有人都看得到计数，登录了才能留言。
   * 计数的逻辑和旧版 SiteFace 一样：页面上每有一次导航或搜索（widgets/server/hits），先在本页加一、再报给服务端，
   * 几处来的数取较大的那个，不会往回走。别人的点击经 /api/site/stream 实时推过来——只在正看着这一页时连着，
   * 在首页和别的子页、标签页在后台时都断开（旧版首页一直连着）；推送连不上时退回每 15 秒轮询一次。
   * 留言要先填图片验证码：开始写的时候才去领题，每次提交（不管成没成）之后都换一张。
   * 管理员的工具在 InkAdmin（只渲染在管理员的页面里）
   */
  import { untrack } from 'svelte';
  import { bump, fetchCounts, mergeCounts, readCounts, reportHit, SITE_STREAM_URL, type SiteCounts } from '../../lib/site-stats';
  import { fetchCaptcha, submitSuggestion, SUGGESTION_LIMITS, type Captcha } from '../../lib/suggestions';
  import { hitOf } from '../../widgets/server/hits';
  import { cnBig, groupDigits } from '../text';

  interface Props {
    counts: SiteCounts;
    /** 站内登录了才能留言 */
    signedIn: boolean;
  }

  let { counts: initial, signedIn }: Props = $props();

  const POLL_MS = 15_000;
  const CAPTCHA_LENGTH = 4;

  let counts = $state(untrack(() => initial));
  let watching = $state(false);

  let draft = $state('');
  let captcha = $state<Captcha | undefined>(undefined);
  let answer = $state('');
  let loadingCaptcha = $state(false);
  let busy = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);

  let stream: EventSource | undefined;
  let polling = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const total = $derived(counts.nav + counts.search);

  function learn(next: SiteCounts | undefined): void {
    if (next) counts = mergeCounts(counts, next);
  }

  function onHit(event: MouseEvent): void {
    const kind = hitOf(event);
    if (!kind) return;
    counts = bump(counts, kind);
    void reportHit(kind).then(learn);
  }

  function connect(): void {
    if (stream || polling) {
      if (polling) void refresh();
      return;
    }
    if (typeof EventSource !== 'function') {
      polling = true;
      void refresh();
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
      if (source.readyState !== EventSource.CLOSED) return;
      disconnect();
      polling = true;
      void refresh();
    };
  }

  function disconnect(): void {
    stream?.close();
    stream = undefined;
    clearTimeout(poll);
    controller?.abort();
  }

  async function refresh(): Promise<void> {
    clearTimeout(poll);
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const next = await fetchCounts(current.signal);
    if (current.signal.aborted) return;
    learn(next);
    if (watching && document.visibilityState === 'visible') poll = setTimeout(() => void refresh(), POLL_MS);
  }

  /** 只在正看着「跋」、标签页在前台时连着 */
  function sync(): void {
    watching = document.documentElement.dataset.route === 'site' && document.visibilityState === 'visible';
    if (watching) connect();
    else disconnect();
  }

  $effect(() => {
    document.addEventListener('click', onHit);
    document.addEventListener('auxclick', onHit);
    document.addEventListener('visibilitychange', sync);
    addEventListener('ink:route', sync);
    sync();
    return () => {
      document.removeEventListener('click', onHit);
      document.removeEventListener('auxclick', onHit);
      document.removeEventListener('visibilitychange', sync);
      removeEventListener('ink:route', sync);
      disconnect();
    };
  });

  async function loadCaptcha(): Promise<void> {
    if (loadingCaptcha) return;
    loadingCaptcha = true;
    answer = '';
    const result = await fetchCaptcha();
    loadingCaptcha = false;
    if (result.ok) captcha = result.captcha;
    else notice = { kind: 'error', text: result.message };
  }

  function onFormFocus(): void {
    if (!captcha) void loadCaptcha();
  }

  const ready = $derived(!busy && draft.trim() !== '' && captcha !== undefined && answer.trim().length >= CAPTCHA_LENGTH);

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!ready || !captcha) return;
    busy = true;
    notice = undefined;
    const result = await submitSuggestion(draft, captcha.id, answer);
    busy = false;
    captcha = undefined;
    answer = '';
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      void loadCaptcha();
      return;
    }
    draft = '';
    notice = { kind: 'ok', text: '已呈上，谢谢' };
    dispatchEvent(new Event('ink:suggested'));
  }
</script>

<div class="cnt">
  <p>
    本站已经替你导航与搜索了<b>{cnBig(total)}</b>次。
  </p>
  <p class="cnt-sub">其中导航 {groupDigits(counts.nav)} 次，搜索 {groupDigits(counts.search)} 次{watching ? '，有人点就跟着走' : ''}。</p>
</div>

<div class="sug blk">
  <h2 class="blk-h">留 言</h2>
  {#if signedIn}
    <form onsubmit={onSubmit} onfocusin={onFormFocus}>
      <label class="visually-hidden" for="ink-suggest">你的建议</label>
      <textarea id="ink-suggest" bind:value={draft} maxlength={SUGGESTION_LIMITS.body} placeholder="有什么想改的、想要的，写在这里。"></textarea>
      <div class="cap">
        {#if captcha}
          <button type="button" class="cap-img" title="看不清？点一下换一张" disabled={loadingCaptcha || busy} onclick={() => void loadCaptcha()}>
            <img src={captcha.image} alt="验证码图片：请把图里的 4 个数字填进右边的框" width="140" height="48" />
          </button>
        {:else}
          <span class="cap-img cap-empty" aria-hidden="true">{loadingCaptcha ? '取图中…' : '写字时出题'}</span>
        {/if}
        <label class="visually-hidden" for="ink-captcha">验证码</label>
        <input id="ink-captcha" bind:value={answer} inputmode="numeric" autocomplete="off" maxlength={CAPTCHA_LENGTH} placeholder="验证码" />
        <button type="button" class="ghost" disabled={loadingCaptcha || busy} onclick={() => void loadCaptcha()}>换一张</button>
        <span class="c" aria-hidden="true">{draft.length} / {SUGGESTION_LIMITS.body}</span>
        <button type="submit" class="seal" aria-label="提交" disabled={!ready}>{busy ? '…' : '呈'}</button>
      </div>
      {#if notice}
        <p class="add-note" data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
      {/if}
    </form>
  {:else}
    <p class="none"><a class="inline" href="/login">登录</a>后可以留言。</p>
  {/if}
</div>
