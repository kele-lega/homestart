<!--
  新建、修改自己的日程：一张浮起来的纸（PaperDialog），填法照 Google 日历：
  标题，开始日期 + 钟点 – 结束钟点 + 日期，「全天」勾选，地点。改开始时结束跟着挪，时长不变。
  保存在服务端、按账号存，换设备登录也看得到；在设置页连上 Google 日历后，同时写进自己的 Google 日历
-->
<script lang="ts">
  import { tick } from 'svelte';
  import PaperDialog from '../../components/PaperDialog.svelte';
  import { draftFields, fieldsProblem, moveStart, type EventFields } from '../../lib/event-fields';
  import { readResult } from '../../lib/settings-api';
  import { sendAction } from '../../lib/widget-api';
  import { localTimeText } from '../../lib/zoned-time';

  interface Props {
    /** 日历实例的 id */
    id: string;
    /** 站点时区的今天 'YYYY-MM-DD' */
    today: string;
    timeZone: string;
    /** 保存或删除成功以后：月历重取日程 */
    onsaved: () => void;
  }

  let { id, today, timeZone, onsaved }: Props = $props();

  let sheet = $state<PaperDialog>();
  let titleInput = $state<HTMLInputElement>();
  /** 正在改的那件；新建时没有 */
  let editing = $state<string | undefined>(undefined);
  // 打开时由 create / edit 填好；这里只是占位
  let fields = $state<EventFields>(draftFields('2000-01-01', '', '00:00'));
  let busy = $state(false);
  let confirming = $state(false);
  let error = $state<string | undefined>(undefined);

  async function show(id: string | undefined, initial: EventFields): Promise<void> {
    editing = id;
    fields = initial;
    error = undefined;
    confirming = false;
    if (!sheet?.open()) return;
    await tick();
    titleInput?.focus();
  }

  /** 在某一天新建 */
  export function create(date: string): Promise<void> {
    return show(undefined, draftFields(date, today, localTimeText(Date.now(), timeZone)));
  }

  export function edit(eventId: string, initial: EventFields): Promise<void> {
    return show(eventId, initial);
  }

  function setStart(date: string, time: string): void {
    fields = moveStart(fields, { date, time });
  }

  function setAllDay(allDay: boolean): void {
    // 从全天改成定时、又没有钟点（存的时候清掉了）：补上 9 点到 10 点
    const timed = !allDay && !fields.startTime ? { startTime: '09:00', endTime: '10:00' } : {};
    fields = { ...fields, ...timed, allDay };
  }

  async function run(request: () => Promise<unknown>): Promise<void> {
    busy = true;
    error = undefined;
    let result;
    try {
      result = readResult(await request());
    } catch {
      result = { ok: false as const, message: '网络出了点问题，没能保存' };
    }
    busy = false;
    if (!result.ok) {
      error = result.message;
      return;
    }
    sheet?.close();
    onsaved();
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const problem = fieldsProblem(fields);
    if (problem) {
      error = problem;
      return;
    }
    void run(() =>
      editing
        ? sendAction(id, 'update', { method: 'PUT', body: fields, query: { id: editing } })
        : sendAction(id, 'create', { method: 'POST', body: fields }),
    );
  }

  function onRemove(): void {
    const target = editing;
    if (target) void run(() => sendAction(id, 'remove', { method: 'DELETE', query: { id: target } }));
  }
</script>

<PaperDialog bind:this={sheet} title={editing ? '修改日程' : '新建日程'} labelId="{id}-event-title" onclose={() => (confirming = false)}>
  <form class="compose event-form" onsubmit={onSubmit} novalidate>
    <label class="field">
      <span class="visually-hidden">标题</span>
      <input class="input title" bind:this={titleInput} bind:value={fields.title} placeholder="添加标题" maxlength="200" autocomplete="off" />
    </label>

    <fieldset class="when">
      <legend class="field-label">时间</legend>
      <div class="when-row">
        <label class="field">
          <span class="visually-hidden">开始日期</span>
          <input class="input" type="date" value={fields.startDate} oninput={(e) => setStart(e.currentTarget.value, fields.startTime)} required />
        </label>
        {#if !fields.allDay}
          <label class="field">
            <span class="visually-hidden">开始时间</span>
            <input class="input" type="time" step="60" value={fields.startTime} oninput={(e) => setStart(fields.startDate, e.currentTarget.value)} required />
          </label>
        {/if}
        <span class="dash" aria-hidden="true">–</span>
        {#if !fields.allDay}
          <label class="field">
            <span class="visually-hidden">结束时间</span>
            <input class="input" type="time" step="60" bind:value={fields.endTime} required />
          </label>
        {/if}
        <label class="field">
          <span class="visually-hidden">结束日期</span>
          <input class="input" type="date" bind:value={fields.endDate} min={fields.startDate} required />
        </label>
      </div>
      <label class="all-day">
        <input type="checkbox" checked={fields.allDay} onchange={(e) => setAllDay(e.currentTarget.checked)} />
        全天
      </label>
    </fieldset>

    <label class="field">
      <span class="field-label">地点</span>
      <input class="input" bind:value={fields.location} placeholder="添加地点" maxlength="200" autocomplete="off" />
    </label>

    {#if error}<p class="notice" data-kind="error" role="alert">{error}</p>{/if}

    <div class="actions">
      <button type="submit" class="btn" data-kind="primary" disabled={busy}>保存</button>
      <button type="button" class="btn" disabled={busy} onclick={() => sheet?.close()}>取消</button>
      {#if editing}
        <span class="remove">
          {#if confirming}
            <span class="confirm-text">删掉这件日程？</span>
            <button type="button" class="text-btn" data-kind="danger" disabled={busy} onclick={onRemove}>确认删除</button>
            <button type="button" class="text-btn" disabled={busy} onclick={() => (confirming = false)}>取消</button>
          {:else}
            <button type="button" class="text-btn" data-kind="danger" disabled={busy} onclick={() => (confirming = true)}>删除</button>
          {/if}
        </span>
      {/if}
    </div>
  </form>
  <p class="hint">保存在你的账号里，换台设备登录也能看到；在设置页连上 Google 日历后会同步过去。</p>
</PaperDialog>

<style>
  /* 输入框、按钮的样子在 PaperDialog；这里只排时间那一行 */
  .event-form {
    border-block-end: 0;
  }

  .title {
    font-size: var(--text-xl);
  }

  .when {
    display: grid;
    gap: var(--space-2);
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .when-row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2) var(--space-3);
  }

  .when-row .input {
    inline-size: auto;
    font-size: var(--text-base);
  }

  .dash {
    padding-block-end: var(--space-1);
    color: var(--ink-3);
  }

  .all-day {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font: var(--text-sm) / 1.5 var(--label);
    color: var(--ink-2);
  }

  .notice {
    margin: 0;
  }

  .actions {
    flex-wrap: wrap;
    align-items: center;
  }

  .remove {
    display: inline-flex;
    gap: var(--space-3);
    align-items: center;
    margin-inline-start: auto;
  }

  .hint {
    margin: 0 var(--space-6) var(--space-4);
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--ink-3);
  }

  @media (width <= 48rem) {
    .hint {
      margin-inline: var(--space-4);
    }
  }
</style>
