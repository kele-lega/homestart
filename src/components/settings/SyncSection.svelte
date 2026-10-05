<!--
  写回 Google 日历：在月历里自己添加的日程推到自己的 Google 日历。
  每个人各自部署一个 Apps Script 网页应用（脚本以本人身份运行，只碰他自己的默认日历），这里只填它的地址。
  没连上时：点「开始连接」拿到带口令的脚本 → 照步骤部署 → 粘贴地址。连上后只显示状态和「断开」
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { SyncSettings } from '../../adapters/calendar/google-sync';
  import {
    checkCalendarSync,
    connectCalendarSync,
    disconnectCalendarSync,
    prepareCalendarSync,
    type SettingsResult,
  } from '../../lib/settings-api';

  interface Props {
    settings: SyncSettings;
  }

  let { settings: initial }: Props = $props();
  let settings = $state(untrack(() => initial));
  let busy = $state(false);
  let copied = $state(false);
  let url = $state('');
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);

  const script = $derived(settings.script);
  /** 已连接时「更新脚本」那几步是收起的 */
  let updating = $state(false);

  async function run(task: () => Promise<SettingsResult<SyncSettings>>, done: (next: SyncSettings) => string): Promise<void> {
    busy = true;
    notice = undefined;
    const result = await task();
    busy = false;
    if (!result.ok) {
      notice = { kind: 'error', text: result.message };
      return;
    }
    settings = result.data;
    notice = { kind: 'ok', text: done(result.data) };
  }

  function pendingText(next: SyncSettings): string {
    if (!next.connected) return '';
    return next.pending > 0 ? `，还有 ${next.pending} 件日程正在同步` : '';
  }

  async function copy(): Promise<void> {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      notice = { kind: 'error', text: '没能复制，请在下面的框里全选后手动复制' };
    }
  }

  function onConnect(event: SubmitEvent): void {
    event.preventDefault();
    void run(
      () => connectCalendarSync(url),
      (next) => {
        url = '';
        return `已连接${pendingText(next)}。之后在月历里新建、修改、删除日程都会同步过去`;
      },
    );
  }
</script>

<div class="sync" id="calendar-sync">
  <h3 class="sync-title">写回 Google 日历</h3>
  {#if settings.connected}
    <p class="sync-status">
      <span>
        已连接{settings.calendar ? `，写进「${settings.calendar}」` : ''}：在月历里新建、修改、删除的日程会同步过去{settings.pending > 0
          ? `（${settings.pending} 件等待同步）`
          : ''}
      </span>
      <button
        type="button"
        class="leaf-link"
        disabled={busy}
        onclick={() =>
          run(checkCalendarSync, (next) => (next.connected && next.pending > 0 ? `连上了，还有 ${next.pending} 件没推过去` : '连接正常，都已同步'))}
        >{busy ? '正在检查…' : '检查连接并同步'}</button
      >
      <button
        type="button"
        class="leaf-link"
        data-kind="danger"
        disabled={busy}
        onclick={() => run(disconnectCalendarSync, () => '已断开，之后的改动只存在本站')}>断开</button
      >
    </p>
    {#if settings.error}<p class="leaf-notice" data-kind="error">上次同步失败：{settings.error}</p>{/if}
    <p class="leaf-card-hint">写进哪个日历：上面「日历订阅」填的是 Google 日历就写进那一个，首页和手机上看到的是同一个；没填时写进默认日历。</p>
    {#if updating}
      <ol class="steps">
        <li>
          打开 <a class="leaf-link" href="https://script.google.com/home" target="_blank" rel="noopener noreferrer">script.google.com</a> 里之前的项目，把代码全部换成下面这段，保存。
          <span class="copy-row">
            <button type="button" class="leaf-link" onclick={copy}>{copied ? '已复制' : '复制脚本'}</button>
          </span>
          <textarea class="leaf-input code" readonly rows="6" aria-label="Apps Script 脚本" value={script}></textarea>
        </li>
        <li>「部署」→「管理部署」→ 点铅笔 → 版本选「新版本」→ 部署。网址不变，不用重新粘贴；第一次会再要一次日历授权。</li>
        <li>回到这里点「检查连接并同步」。</li>
      </ol>
    {:else}
      <div class="leaf-actions">
        <button type="button" class="leaf-link" onclick={() => (updating = true)}>更新脚本</button>
      </div>
    {/if}
  {:else if !script}
    <p class="leaf-card-hint">
      在月历里自己添加的日程现在只存在本站（换设备登录也在）。想让它们也出现在手机的 Google 日历里，可以连上自己的 Google 账号：
      部署一小段 Google Apps Script，五分钟就好，不需要别的账号和密钥。
    </p>
    <div class="leaf-actions">
      <button type="button" class="leaf-btn" disabled={busy} onclick={() => run(prepareCalendarSync, () => '')}>开始连接</button>
    </div>
  {:else}
    <ol class="steps">
      <li>
        打开 <a class="leaf-link" href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com 新建项目</a>（登录要同步的那个 Google 账号）。
      </li>
      <li>
        把编辑器里原有的代码全部删掉，换成下面这段，保存。
        <span class="copy-row">
          <button type="button" class="leaf-link" onclick={copy}>{copied ? '已复制' : '复制脚本'}</button>
          <span class="leaf-meta">里面的口令只属于你，不要发给别人</span>
        </span>
        <textarea class="leaf-input code" readonly rows="6" aria-label="Apps Script 脚本" value={script}></textarea>
      </li>
      <li>
        右上角「部署」→「新建部署」→ 类型选「网页应用」：执行身份选「我」，有权访问的人选「任何人」→ 部署，按提示授权访问日历。
        <span class="leaf-meta step-note">
          不要选「拥有 Google 账号的任何用户」：本站不带你的 Google 登录去调脚本，会被拒绝（401）。
          口令写在脚本里，别人拿到地址也调不动。已经部署过的，在「管理部署」里改成「任何人」，再部署一个新版本。
        </span>
      </li>
      <li>复制得到的网页应用网址，粘贴到这里：</li>
    </ol>
    <form class="leaf-form" onsubmit={onConnect}>
      <label class="leaf-field">
        <span class="leaf-field-label">网页应用网址</span>
        <input
          class="leaf-input"
          type="url"
          required
          autocomplete="off"
          spellcheck="false"
          placeholder="https://script.google.com/macros/s/…/exec"
          bind:value={url}
        />
      </label>
      <div class="leaf-actions">
        <button type="submit" class="leaf-btn" data-kind="primary" disabled={busy}>{busy ? '正在连接…' : '连接'}</button>
      </div>
    </form>
    <p class="leaf-card-hint">
      上面「日历订阅」填的是 Google 日历时，日程写进那一个日历（首页和手机上看到的是同一个），不会显示两遍；没填时写进默认日历。
    </p>
  {/if}
  {#if notice?.text}<p class="leaf-notice" data-kind={notice.kind} role="status">{notice.text}</p>{/if}
</div>

<style>
  .sync {
    display: grid;
    gap: var(--space-3);
    margin-block-start: var(--space-4);
    padding-block-start: var(--space-4);
    border-block-start: var(--rule-thin);
  }

  .sync-title {
    font: 700 var(--text-base) / 1.5 var(--font-body);
  }

  .sync-status {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }

  .steps {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding-inline-start: 1.25rem;
    font-size: var(--text-sm);
    line-height: 1.7;
  }

  .step-note {
    display: block;
    margin-block-start: var(--space-1);
  }

  .copy-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    margin-block: var(--space-1);
  }

  .code {
    inline-size: 100%;
    font: var(--text-xs) / 1.5 ui-monospace, monospace;
    resize: vertical;
  }
</style>
