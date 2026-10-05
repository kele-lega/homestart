import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoogleSync, normalizeScriptUrl, scriptSource } from '../../../src/adapters/calendar/google-sync';
import { createLocalEvents, createLocalEventsStore, hiddenByOwn } from '../../../src/adapters/calendar/local-events';
import { createUserStore } from '../../../src/adapters/user-store';
import { ANONYMOUS } from '../../../src/core/api';
import { ActionInputError } from '../../../src/core/widget';
import type { EventFields } from '../../../src/lib/event-fields';

const ZONE = 'Asia/Shanghai';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx0123456789abcdefghij/exec';
const SECRET = 's'.repeat(32);
const FIELDS: EventFields = {
  title: '组会',
  location: '三楼',
  allDay: false,
  startDate: '2026-03-12',
  startTime: '09:00',
  endDate: '2026-03-12',
  endTime: '10:30',
};

interface GoogleEvent {
  readonly event: Readonly<Record<string, unknown>>;
  /** 在哪个日历里；DEFAULT 是默认日历 */
  readonly in: string;
}

const DEFAULT = '(默认)';
const WEB_CAL = 'abc123@group.calendar.google.com';
const WEB_ICS = `https://calendar.google.com/calendar/ical/${encodeURIComponent(WEB_CAL)}/private-xyz/basic.ics`;

interface Body {
  secret?: string;
  op?: string;
  uid?: string;
  from?: string;
  calendar?: string;
  event?: Readonly<Record<string, unknown>>;
}

/**
 * 假的 Apps Script 网页应用：POST 先 302 到 googleusercontent，GET 那个地址取结果，和真的一样。
 * calendar 是「Google 日历」里的日程；version 是部署的脚本版本（1 版不认 calendar、写进默认日历）
 */
function fakeScript({ secret = SECRET, version = 2 }: { secret?: string; version?: number } = {}) {
  const calendar = new Map<string, GoogleEvent>();
  const results = new Map<string, unknown>();
  let next = 0;
  let down = false;
  const handle = (body: Body) => {
    if (body.secret !== secret) return { ok: false, error: 'forbidden' };
    const target = (version >= 2 && body.calendar) || DEFAULT;
    if (body.op === 'ping') return { ok: true, calendar: target === DEFAULT ? '我的日历' : 'use for web' };
    const home = (version >= 2 && body.from) || DEFAULT;
    const existing = body.uid ? calendar.get(body.uid) : undefined;
    const found = existing && existing.in === home ? existing : undefined;
    if (body.op === 'delete') {
      if (found) calendar.delete(body.uid!);
      return { ok: true };
    }
    if (body.uid && !found) return { ok: true, gone: true };
    // 换日历：旧的删掉，新日历里新建（新 uid）
    if (found && home !== target) calendar.delete(body.uid!);
    const uid = found && home === target ? body.uid! : `g${++next}@google.com`;
    calendar.set(uid, { event: body.event!, in: target });
    return { ok: true, uid };
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (down) throw new TypeError('fetch failed');
    const url = new URL(String(input));
    if (init?.method === 'POST') {
      expect(url.href).toBe(SCRIPT_URL);
      expect(init.redirect).toBe('manual');
      const key = `r${results.size}`;
      const reply = handle(JSON.parse(String(init.body)) as Body);
      results.set(key, version >= 2 ? { ...reply, version } : reply);
      return new Response(null, { status: 302, headers: { location: `https://script.googleusercontent.com/macros/echo?k=${key}` } });
    }
    expect(url.hostname).toBe('script.googleusercontent.com');
    return Response.json(results.get(url.searchParams.get('k')!));
  });
  return {
    calendar,
    fetch,
    setDown: (value: boolean) => {
      down = value;
    },
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'calendar-sync-'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function setup(script = fakeScript(), subscriptions: Record<string, string> = {}) {
  let n = 0;
  let time = 1000;
  const local = createLocalEvents({
    store: createLocalEventsStore(() => path.join(dir, 'events.json')),
    clock: () => time,
    newId: () => `id-${++n}`,
  });
  const syncFile = path.join(dir, 'sync.json');
  const store = createUserStore({
    filePath: () => syncFile,
    parse: (value) => value as { secret: string; url?: string },
    formatError: () => new Error('bad'),
    log: { label: 'test', message: 'bad' },
  });
  const subs = { ...subscriptions };
  const sync = createGoogleSync({
    store,
    local,
    subscription: async (user) => subs[user],
    fetch: script.fetch,
    newSecret: () => SECRET,
    now: () => time,
  });
  const tick = () => {
    time += 1;
  };
  const subscribe = (user: string, url: string) => {
    subs[user] = url;
  };
  return { script, local, sync, syncFile, tick, subscribe, advance: (ms: number) => (time += ms) };
}

async function connected(script = fakeScript(), subscriptions: Record<string, string> = {}) {
  const env = setup(script, subscriptions);
  await env.sync.prepareSync('alice');
  await env.sync.connectSync('alice', SCRIPT_URL, ZONE);
  return env;
}

describe('normalizeScriptUrl', () => {
  it('accepts only Apps Script web app addresses', () => {
    expect(normalizeScriptUrl(`${SCRIPT_URL}?foo=1#x`)).toBe(SCRIPT_URL);
    expect(normalizeScriptUrl('https://script.google.com/a/macros/example.com/s/AKfycbx0123456789abcdefghij/exec')).toBeTruthy();
    expect(normalizeScriptUrl(SCRIPT_URL.replace('https:', 'http:'))).toBeUndefined();
    expect(normalizeScriptUrl(SCRIPT_URL.replace('script.google.com', 'evil.example.com'))).toBeUndefined();
    expect(normalizeScriptUrl(SCRIPT_URL.replace('/exec', '/dev'))).toBeUndefined();
    expect(normalizeScriptUrl('not a url')).toBeUndefined();
  });
});

describe('connecting', () => {
  it('hands out a script with a per-user secret, then checks the deployed address before saving it', async () => {
    const { sync, syncFile } = setup();

    expect(await sync.readSyncSettings('alice')).toEqual({ connected: false, script: undefined });
    const prepared = await sync.prepareSync('alice');
    expect(prepared).toEqual({ connected: false, script: scriptSource(SECRET) });
    expect(scriptSource(SECRET)).toContain(`const SECRET = '${SECRET}'`);

    await expect(sync.connectSync('alice', 'https://example.com/x', ZONE)).rejects.toBeInstanceOf(ActionInputError);
    expect(await sync.connectSync('alice', SCRIPT_URL, ZONE)).toEqual({
      connected: true,
      pending: 0,
      calendar: '我的日历',
      error: undefined,
      script: scriptSource(SECRET),
    });
    expect(JSON.parse(await readFile(syncFile, 'utf8'))).toEqual({ alice: { secret: SECRET, url: SCRIPT_URL, calendarName: '我的日历' } });
    // 每个用户各自的：bob 没连
    expect(await sync.readSyncSettings('bob')).toEqual({ connected: false, script: undefined });
  });

  it('refuses a script with another secret, one that wants a login, and visitors', async () => {
    const wrong = setup(fakeScript({ secret: 'x'.repeat(32) }));
    await wrong.sync.prepareSync('alice');
    await expect(wrong.sync.connectSync('alice', SCRIPT_URL, ZONE)).rejects.toThrow('口令不对');

    const login = setup({
      ...fakeScript(),
      fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/login' } })),
    });
    await login.sync.prepareSync('alice');
    await expect(login.sync.connectSync('alice', SCRIPT_URL, ZONE)).rejects.toThrow('任何人');

    await expect(login.sync.prepareSync(ANONYMOUS)).rejects.toBeInstanceOf(ActionInputError);
  });

  it('explains which deployment setting is wrong when the script answers 401, 403 or 404', async () => {
    for (const [status, hint] of [
      [401, '「有权访问的人」选「任何人」'],
      [403, '「有权访问的人」选「任何人」'],
      [404, '/exec 地址'],
      [500, '返回 500'],
    ] as const) {
      const denied = setup({ ...fakeScript(), fetch: vi.fn<typeof fetch>(async () => new Response('denied', { status })) });
      await denied.sync.prepareSync('alice');
      await expect(denied.sync.connectSync('alice', SCRIPT_URL, ZONE)).rejects.toThrow(hint);
      // 没连上：地址不存下来
      expect(await denied.sync.readSyncSettings('alice')).toMatchObject({ connected: false });
    }
  });

  it('pushes events added before connecting, and keeps the secret after disconnecting', async () => {
    const { sync, local, script } = setup();
    await local.create('alice', FIELDS);
    await sync.prepareSync('alice');

    await sync.connectSync('alice', SCRIPT_URL, ZONE);
    expect(script.calendar.size).toBe(1);

    expect(await sync.disconnectSync('alice')).toEqual({ connected: false, script: scriptSource(SECRET) });
    expect(await sync.pendingCount('alice')).toBeUndefined();
  });
});

describe('pushing changes', () => {
  it('creates, updates and deletes in Google Calendar, remembering its UID', async () => {
    const { sync, local, script, tick } = await connected();

    const { id } = await local.create('alice', FIELDS);
    expect(await sync.syncNow('alice', ZONE)).toBe(0);
    const [record] = await local.records('alice');
    expect(record).toMatchObject({ uid: 'g1@google.com', synced: true });
    expect(script.calendar.get('g1@google.com')!.event).toEqual({
      title: '组会',
      location: '三楼',
      allDay: false,
      start: Date.UTC(2026, 2, 12, 1),
      end: Date.UTC(2026, 2, 12, 2, 30),
    });

    tick();
    await local.update('alice', id, { ...FIELDS, allDay: true, endDate: '2026-03-13' });
    await sync.syncNow('alice', ZONE);
    // 全天日程给 Google 的结束日期不含当天
    expect(script.calendar.get('g1@google.com')!.event).toMatchObject({ allDay: true, startDate: '2026-03-12', endDate: '2026-03-14' });

    tick();
    await local.remove('alice', id);
    await sync.syncNow('alice', ZONE);
    expect(script.calendar.size).toBe(0);
    expect(await local.list('alice')).toEqual([]);
    // 墓碑还在，订阅跟上之前用来藏住订阅里的旧副本
    expect(await local.records('alice')).toEqual([expect.objectContaining({ deleted: true, synced: true, uid: 'g1@google.com' })]);
  });

  it('keeps changes waiting while Google is unreachable and pushes them later', async () => {
    const { sync, local, script } = await connected();
    script.setDown(true);

    await local.create('alice', FIELDS);
    expect(await sync.syncNow('alice', ZONE)).toBe(1);

    script.setDown(false);
    expect(await sync.syncNow('alice', ZONE)).toBe(0);
    expect(script.calendar.size).toBe(1);
  });

  it('deletes here what was deleted in Google Calendar, on the next change', async () => {
    const { sync, local, script, tick } = await connected();
    const { id } = await local.create('alice', FIELDS);
    await sync.syncNow('alice', ZONE);

    script.calendar.clear();
    tick();
    await local.update('alice', id, { ...FIELDS, title: '改了' });
    await sync.syncNow('alice', ZONE);

    expect(await local.list('alice')).toEqual([]);
    expect(script.calendar.size).toBe(0);
  });

  it('pushes an edit made while the previous push was on its way', async () => {
    const { sync, local, script, tick } = await connected();
    const { id } = await local.create('alice', FIELDS);
    const first = sync.syncNow('alice', ZONE);
    tick();
    await local.update('alice', id, { ...FIELDS, title: '新标题' });
    await first;
    await sync.syncNow('alice', ZONE);

    expect([...script.calendar.values()].map(({ event }) => event.title)).toEqual(['新标题']);
    expect(await local.records('alice')).toEqual([expect.objectContaining({ synced: true, title: '新标题' })]);
  });

  it('drops tombstones a few days after the delete went through', async () => {
    const { sync, local, advance } = await connected();
    const { id } = await local.create('alice', FIELDS);
    await sync.syncNow('alice', ZONE);
    await local.remove('alice', id);
    await sync.syncNow('alice', ZONE);

    advance(3 * 24 * 3_600_000);
    await local.create('alice', { ...FIELDS, title: '另一件' });

    expect((await local.records('alice')).map((event) => event.title)).toEqual(['另一件']);
  });

  it('does nothing for users who did not connect', async () => {
    const { sync, local, script } = setup();
    await local.create('bob', FIELDS);

    expect(await sync.syncNow('bob', ZONE)).toBeUndefined();
    sync.syncSoon('bob', ZONE);
    expect(script.fetch).not.toHaveBeenCalled();
  });
});

describe('hiddenByOwn', () => {
  it('hides every occurrence of the subscription copies of pushed events', () => {
    const hidden = hiddenByOwn([
      { ...FIELDS, id: 'local:a', updatedAt: 0, uid: 'g1@google.com' },
      { ...FIELDS, id: 'local:b', updatedAt: 0 },
    ]);

    expect(hidden('g1@google.com@2026-03-12T01:00:00Z')).toBe(true);
    expect(hidden('g1@google.com@2026-03-12#2')).toBe(true);
    expect(hidden('g12@google.com@2026-03-12')).toBe(false);
    expect(hidden('other@google.com@2026-03-12')).toBe(false);
  });
});
