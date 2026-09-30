import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { CalendarFeed } from '../../../src/adapters/calendar/model';
import { createCalendarService, MAX_RANGE_DAYS, type DateRange } from '../../../src/adapters/calendar/service';
import { CalendarStoreError, createCalendarStore, type CalendarStore } from '../../../src/adapters/calendar/store';
import type { LookupFn } from '../../../src/adapters/calendar/url-guard';
import { ANONYMOUS } from '../../../src/core/api';
import { ActionInputError } from '../../../src/core/widget';
import { calendar, vevent } from './ics';

const ZONE = 'Asia/Shanghai';
const MARCH: DateRange = { from: '2026-03-01', to: '2026-04-01' };
// 订阅地址等同于访问凭据：路径和查询参数都不能出现在返回值和日志里
const SECRET_PATH = 'private-0123abcd';
const SECRET_TOKEN = 'tok-9f8e7d';
const SECRET_URL = `https://calendar.example.com/${SECRET_PATH}/basic.ics?token=${SECRET_TOKEN}`;
const OTHER_URL = 'https://ics.example.org/team/basic.ics';
const PUBLIC_IP = '93.184.216.34';
const BASE_TIME = Date.UTC(2026, 2, 1);

/** 每个标题一个定时日程：2026-03-10 起每小时一个 */
function feed(...titles: string[]): string {
  const events = titles.map((title, i) =>
    vevent(`UID:${title}@test`, `DTSTART:20260310T${String(9 + i).padStart(2, '0')}0000Z`, 'DURATION:PT30M', `SUMMARY:${title}`),
  );
  return calendar(...events);
}

function titles(result: CalendarFeed): string[] {
  if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.events.map((event) => event.title);
}

type Reply = { readonly status?: number; readonly body?: string } | Error;

/** 假的上游：每次调用都按 reply 新建一个 Response（响应体只能读一次） */
function serve(reply: Reply) {
  return async () => {
    if (reply instanceof Error) throw reply;
    return new Response(reply.body ?? '', { status: reply.status ?? 200 });
  };
}

/** 假的 DNS：默认都解析到公网地址，个别主机按表解析 */
function lookupWith(table: Readonly<Record<string, string>> = {}) {
  return vi.fn<LookupFn>(async (host) => [{ address: table[host] ?? PUBLIC_IP, family: 4 }]);
}

/** 内存里的设置存储，不碰磁盘 */
function memoryStore(initial: Readonly<Record<string, string>>) {
  const urls = new Map(Object.entries(initial));
  return {
    get: vi.fn<CalendarStore['get']>(async (user) => urls.get(user)),
    put: vi.fn<CalendarStore['put']>(async (user, url) => {
      if (url === undefined) urls.delete(user);
      else urls.set(user, url);
    }),
  };
}

interface Setup {
  readonly urls?: Readonly<Record<string, string>>;
  readonly reply?: Reply;
  readonly lookup?: ReturnType<typeof lookupWith>;
}

function setup({ urls = { alice: SECRET_URL }, reply = { body: feed('A') }, lookup = lookupWith() }: Setup = {}) {
  const upstream = vi.fn<typeof fetch>(serve(reply));
  const store = memoryStore(urls);
  // 缓存的单调时钟由用例推进；fetchedAt 用 BASE_TIME + 同一个时钟
  let time = 0;
  const service = createCalendarService({ store, fetch: upstream, lookup, now: () => time, clock: () => BASE_TIME + time });
  const advance = (ms: number) => {
    time += ms;
  };
  const events = (user = 'alice', range: DateRange = MARCH) => service.getCalendarEvents(user, range, { timeZone: ZONE });
  return { service, upstream, lookup, store, advance, events };
}

let logged: MockInstance<typeof console.error>;

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 后台刷新结束的标志是它写的那行日志；再等一轮，让刷新剩下的回调跑完 */
async function waitLogged(count: number): Promise<void> {
  await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(count));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 立刻接住拒绝的原因，免得在断言之前被当成未处理的拒绝；没有拒绝时是 undefined */
function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

async function inputError(promise: Promise<unknown>): Promise<string> {
  const error = await reasonOf(promise);
  expect(error).toBeInstanceOf(ActionInputError);
  return (error as ActionInputError).message;
}

describe('getCalendarEvents caching', () => {
  it('coalesces parallel requests into one upstream fetch', async () => {
    // Arrange
    const { upstream, lookup, events } = setup();

    // Act
    const results = await Promise.all([events(), events(), events()]);

    // Assert
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    for (const result of results) expect(titles(result)).toEqual(['A']);
  });

  it('serves the cached feed for 120 seconds, then refreshes in the background', async () => {
    // Arrange
    const { upstream, advance, events } = setup();
    const first = await events();
    upstream.mockImplementation(serve({ body: feed('B') }));

    // Act
    advance(119_999);
    const fresh = await events();
    advance(1);
    const expired = await events();
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(2));
    const refreshed = await vi.waitUntil(async () => {
      const result = await events();
      return titles(result)[0] === 'B' ? result : undefined;
    });

    // Assert：过期的那一次先拿旧数据，不等刷新；刷新失败才算 stale
    expect(first).toEqual({ status: 'ok', events: expect.any(Array), stale: false, fetchedAt: BASE_TIME });
    expect(fresh).toEqual(first);
    expect(expired).toEqual(first);
    expect(refreshed).toMatchObject({ status: 'ok', stale: false, fetchedAt: BASE_TIME + 120_000 });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the old feed with stale: true while refreshes fail, for up to 24 hours', async () => {
    // Arrange
    const { upstream, advance, events } = setup();
    await events();
    upstream.mockImplementation(serve({ status: 503 }));

    // Act
    advance(120_000);
    await events();
    await waitLogged(1);
    const stale = await events();
    await waitLogged(2);
    // 旧数据最多再用 24 小时（从上次成功算起：新鲜期 + 24 小时）
    advance(24 * 3_600_000);
    const expired = await events();

    // Assert
    expect(stale).toMatchObject({ status: 'ok', stale: true, fetchedAt: BASE_TIME });
    expect(titles(stale)).toEqual(['A']);
    expect(expired).toEqual({ status: 'error', message: '日历服务器返回 HTTP 503' });
  });

  it('does not cache failures: the next request fetches again', async () => {
    // Arrange
    const { upstream, events } = setup({ reply: { status: 500 } });
    const failed = await events();
    upstream.mockImplementation(serve({ body: feed('A') }));

    // Act
    const recovered = await events();

    // Assert
    expect(failed).toEqual({ status: 'error', message: '日历服务器返回 HTTP 500' });
    expect(recovered).toMatchObject({ status: 'ok', stale: false });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('clears stale once a later background refresh succeeds', async () => {
    // Arrange：第一次后台刷新失败
    const { upstream, advance, events } = setup();
    await events();
    upstream.mockImplementation(serve({ status: 503 }));
    advance(120_000);
    await events();
    await waitLogged(1);
    upstream.mockImplementation(serve({ body: feed('B') }));

    // Act：还是 stale 的这一次触发新的后台刷新，成功后换成新数据
    const stale = await events();
    const recovered = await vi.waitUntil(async () => {
      const result = await events();
      return result.status === 'ok' && !result.stale ? result : undefined;
    });

    // Assert
    expect(stale).toMatchObject({ status: 'ok', stale: true });
    expect(titles(recovered)).toEqual(['B']);
    expect(recovered).toMatchObject({ fetchedAt: BASE_TIME + 120_000 });
  });
});

describe('getCalendarEvents per user', () => {
  it('drops the user cache on save and clear, even when the address does not change', async () => {
    // Arrange
    const { service, upstream, store, events } = setup();
    await events();

    // Act
    await service.saveCalendarUrl('alice', SECRET_URL);
    const afterSave = await events();
    await service.clearCalendarUrl('alice');
    const afterClear = await events();
    // 地址被写回（比如手改设置文件）：旧缓存早已丢掉，重新抓取
    await store.put('alice', SECRET_URL);
    const afterRewrite = await events();

    // Assert
    expect(titles(afterSave)).toEqual(['A']);
    expect(afterClear).toEqual({ status: 'unconfigured' });
    expect(titles(afterRewrite)).toEqual(['A']);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it('keeps a separate cache per user, even for the same address', async () => {
    // Arrange
    const { service, upstream, events } = setup({ urls: { alice: SECRET_URL, bob: OTHER_URL, carol: SECRET_URL } });
    upstream.mockImplementation(async (input) =>
      new Response(new URL(String(input)).host === 'ics.example.org' ? feed('Bob') : feed('Shared')),
    );

    // Act
    const [alice, bob, carol] = await Promise.all([events('alice'), events('bob'), events('carol')]);
    await service.clearCalendarUrl('bob');
    const [aliceAgain, bobAgain] = await Promise.all([events('alice'), events('bob')]);

    // Assert：同一个地址也不合并，每个用户各抓一次
    expect(titles(alice)).toEqual(['Shared']);
    expect(titles(bob)).toEqual(['Bob']);
    expect(titles(carol)).toEqual(['Shared']);
    expect(aliceAgain).toEqual(alice);
    expect(bobAgain).toEqual({ status: 'unconfigured' });
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it('treats the anonymous user as unconfigured and refuses to save or clear for it', async () => {
    // Arrange
    const { service, store, lookup, events } = setup();

    // Act
    const feedResult = await events(ANONYMOUS);
    const settings = await service.readCalendarSettings(ANONYMOUS);
    const saving = inputError(service.saveCalendarUrl(ANONYMOUS, SECRET_URL));
    const clearing = inputError(service.clearCalendarUrl(ANONYMOUS));

    // Assert
    expect(feedResult).toEqual({ status: 'unconfigured' });
    expect(settings).toEqual({ configured: false });
    await expect(saving).resolves.toBe('未登录，无法保存日历设置');
    await expect(clearing).resolves.toBe('未登录，无法保存日历设置');
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('answers unconfigured for a user without an address, without fetching', async () => {
    // Arrange
    const { upstream, events } = setup({ urls: {} });

    // Act
    const result = await events('dave');

    // Assert
    expect(result).toEqual({ status: 'unconfigured' });
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('getCalendarEvents failures', () => {
  it('turns upstream failures into a user-facing message that never contains the address', async () => {
    // Arrange：失败不缓存，同一个服务依次换成各种失败
    const { upstream, events } = setup();
    const cases: readonly (readonly [Reply, string])[] = [
      [{ status: 404 }, '订阅地址已失效，请重新复制私密地址'],
      [{ status: 403 }, '日历服务器拒绝访问，请确认用的是私密地址'],
      [{ body: '<html>login</html>' }, '这个地址返回的不是日历（ICS）文件'],
      [new TypeError(`fetch failed: ${SECRET_URL}`), '无法连接日历服务器'],
      // 解析失败会暂缓重试（见下一个用例），放在最后
      [{ body: 'BEGIN:VCALENDAR\r\nthis is not ics' }, '日历文件格式有误'],
    ];

    // Act
    const results: CalendarFeed[] = [];
    for (const [reply] of cases) {
      upstream.mockImplementation(serve(reply));
      results.push(await events());
    }

    // Assert
    expect(results).toEqual(cases.map(([, message]) => ({ status: 'error', message })));
    const text = JSON.stringify(results);
    for (const secret of [SECRET_PATH, SECRET_TOKEN, 'calendar.example.com']) expect(text).not.toContain(secret);
  });

  it('replays a parse failure for 120 seconds instead of fetching and parsing the same broken file again', async () => {
    // Arrange：解析很费 CPU，文件坏了每次请求都重来一遍，等于让订阅源随意占用服务器
    const { upstream, advance, events } = setup({ reply: { body: 'BEGIN:VCALENDAR\r\nthis is not ics' } });
    const first = await events();

    // Act
    advance(119_000);
    const replayed = await events();
    upstream.mockImplementation(serve({ body: feed('A') }));
    advance(1_000);
    const fixed = await events();

    // Assert
    expect(first).toEqual({ status: 'error', message: '日历文件格式有误' });
    expect(replayed).toEqual(first);
    expect(titles(fixed)).toEqual(['A']);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('checks the stored address again on every fetch, so a DNS change to an internal address is blocked', async () => {
    // Arrange：保存时是公网地址，之后解析到了内网
    const lookup = lookupWith({ 'calendar.example.com': '10.0.0.5' });
    const { upstream, events } = setup({ lookup });

    // Act
    const blocked = await events();
    lookup.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const unresolvable = await events();

    // Assert
    expect(blocked).toEqual({ status: 'error', message: '不能使用本机或内网地址' });
    expect(unresolvable).toEqual({ status: 'error', message: '无法解析这个地址的主机名' });
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('getCalendarEvents range checks', () => {
  it('rejects invalid ranges with a user-facing message before reading any settings', async () => {
    // Arrange
    const { service, store } = setup();
    const cases: readonly (readonly [DateRange, string])[] = [
      [{ from: '2026-3-01', to: '2026-04-01' }, '日期范围无效，格式为 YYYY-MM-DD'],
      [{ from: '2026-02-30', to: '2026-04-01' }, '日期范围无效，格式为 YYYY-MM-DD'],
      [{ from: '2026-03-01', to: '' }, '日期范围无效，格式为 YYYY-MM-DD'],
      [{ from: '1899-12-31', to: '1900-01-02' }, '日期范围只支持 1900 至 2200 年'],
      [{ from: '2200-12-01', to: '2201-01-02' }, '日期范围只支持 1900 至 2200 年'],
      [{ from: '2026-03-01', to: '2026-03-01' }, '结束日期必须晚于开始日期'],
      [{ from: '2026-03-02', to: '2026-03-01' }, '结束日期必须晚于开始日期'],
      [{ from: '2026-01-01', to: '2028-03-12' }, `日期范围最多 ${MAX_RANGE_DAYS} 天`],
    ];

    // Act：匿名用户也先检查范围
    const messages = await Promise.all(
      cases.flatMap(([range]) =>
        ['alice', ANONYMOUS].map((user) => inputError(service.getCalendarEvents(user, range, { timeZone: ZONE }))),
      ),
    );

    // Assert
    expect(messages).toEqual(cases.flatMap(([, message]) => [message, message]));
    expect(store.get).not.toHaveBeenCalled();
  });

  it('accepts the widest allowed ranges', async () => {
    // Arrange
    const { events } = setup();

    // Act
    const results = await Promise.all([
      events('alice', { from: '1900-01-01', to: '1900-02-01' }),
      events('alice', { from: '2200-12-01', to: '2201-01-01' }),
      events('alice', { from: '2026-01-01', to: '2028-03-11' }),
    ]);

    // Assert
    expect(results.map(titles)).toEqual([[], [], ['A']]);
  });

  it('rejects an invalid time zone as a programming error and honours an already aborted signal', async () => {
    // Arrange
    const { service, store } = setup();
    const controller = new AbortController();
    const stop = new Error('stop');
    controller.abort(stop);

    // Act
    const [badZone, aborted] = await Promise.all([
      reasonOf(service.getCalendarEvents('alice', MARCH, { timeZone: 'Mars/Olympus' })),
      reasonOf(service.getCalendarEvents('alice', MARCH, { timeZone: ZONE, signal: controller.signal })),
    ]);

    // Assert：时区不对不是用户输入的问题，不是 ActionInputError，操作会答 500
    expect(badZone).toBeInstanceOf(RangeError);
    expect(badZone).not.toBeInstanceOf(ActionInputError);
    expect(aborted).toBe(stop);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('stops before expanding when the caller gives up during the fetch, and still caches what was fetched', async () => {
    // Arrange：请求在抓取途中被取消（浏览器翻到了别的月份）
    const { service, upstream, events } = setup();
    const controller = new AbortController();
    const stop = new Error('superseded');
    upstream.mockImplementationOnce(async () => {
      controller.abort(stop);
      return new Response(feed('A'));
    });

    // Act
    const aborted = await reasonOf(service.getCalendarEvents('alice', MARCH, { timeZone: ZONE, signal: controller.signal }));
    const later = await events();

    // Assert：抓取是共用的，照常写进缓存，下一个请求不用再抓
    expect(aborted).toBe(stop);
    expect(titles(later)).toEqual(['A']);
    expect(upstream).toHaveBeenCalledOnce();
  });
});

describe('getCalendarEvents range filtering', () => {
  // 窗口 [03-10, 03-12)：上海是 03-09T16:00Z 至 03-11T16:00Z，UTC 是 03-10T00:00Z 至 03-12T00:00Z
  const timed = (title: string, start: string, end: string) =>
    vevent(`UID:${title}@test`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${title}`);
  const allDay = (title: string, start: string, end: string) =>
    vevent(`UID:${title}@test`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${title}`);
  const BOUNDARIES = calendar(
    timed('before', '20260309T150000Z', '20260309T160000Z'),
    timed('overnight', '20260309T153000Z', '20260310T000000Z'),
    timed('morning', '20260310T010000Z', '20260310T020000Z'),
    timed('late', '20260311T155900Z', '20260311T170000Z'),
    timed('after', '20260311T160000Z', '20260311T170000Z'),
    allDay('holiday', '20260311', '20260312'),
    allDay('weekend', '20260312', '20260314'),
    allDay('trip', '20260308', '20260311'),
  );
  const WINDOW: DateRange = { from: '2026-03-10', to: '2026-03-12' };

  it('returns only events overlapping the local-date window [from, to) in the given time zone', async () => {
    // Arrange
    const { service, upstream } = setup({ reply: { body: BOUNDARIES } });

    // Act
    const shanghai = await service.getCalendarEvents('alice', WINDOW, { timeZone: ZONE });
    const utc = await service.getCalendarEvents('alice', WINDOW, { timeZone: 'UTC' });

    // Assert：定时日程跟着时区移动，全天日程只看日期；恰好在边界上结束或开始的不算
    expect(titles(shanghai)).toEqual(['trip', 'overnight', 'morning', 'holiday', 'late']);
    expect(titles(utc)).toEqual(['trip', 'morning', 'holiday', 'late', 'after']);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('returns plain event objects: UTC milliseconds for timed events, date keys for all-day ones', async () => {
    // Arrange
    const { events } = setup({ reply: { body: BOUNDARIES } });

    // Act
    const result = await events('alice', WINDOW);

    // Assert
    const byTitle = new Map(result.status === 'ok' ? result.events.map((event) => [event.title, event]) : []);
    expect(byTitle.get('morning')).toEqual({
      kind: 'timed',
      id: expect.stringMatching(/^morning@test@/),
      title: 'morning',
      location: undefined,
      start: Date.UTC(2026, 2, 10, 1),
      end: Date.UTC(2026, 2, 10, 2),
    });
    expect(byTitle.get('holiday')).toEqual({
      kind: 'all-day',
      id: expect.stringMatching(/^holiday@test@/),
      title: 'holiday',
      location: undefined,
      startDate: '2026-03-11',
      endDate: '2026-03-12',
    });
  });
});

describe('calendar settings', () => {
  it('reads back only the host of the saved address', async () => {
    // Arrange
    const { service } = setup({ urls: { alice: SECRET_URL } });

    // Act
    const [alice, bob] = await Promise.all([service.readCalendarSettings('alice'), service.readCalendarSettings('bob')]);

    // Assert
    expect(alice).toEqual({ configured: true, host: 'calendar.example.com' });
    expect(bob).toEqual({ configured: false });
  });

  it('checks the address (including DNS) before saving the normalised form, and returns only the host', async () => {
    // Arrange
    const { service, store, lookup } = setup({ urls: {} });

    // Act
    const saved = await service.saveCalendarUrl('bob', `  ${SECRET_URL.replace('https://calendar.example.com', 'HTTPS://Calendar.Example.COM')}  `);

    // Assert
    expect(saved).toEqual({ configured: true, host: 'calendar.example.com' });
    expect(lookup).toHaveBeenCalledWith('calendar.example.com');
    expect(store.put).toHaveBeenCalledExactlyOnceWith('bob', SECRET_URL);
  });

  it('rejects bad addresses with a user-facing message and keeps the previous setting', async () => {
    // Arrange
    const lookup = lookupWith({ 'intranet.example.com': '198.51.100.7' });
    const { service, store } = setup({ lookup });
    const cases: readonly (readonly [string, string])[] = [
      ['calendar.example.com/basic.ics', '请填写完整的 https:// 订阅地址'],
      ['http://calendar.example.com/basic.ics', 'http:// 会把私密地址明文发出去，请改用 https:// 开头的地址'],
      ['webcal://calendar.example.com/basic.ics', 'webcal:// 地址请把开头改成 https:// 再保存'],
      ['https://me:pw@calendar.example.com/basic.ics', '地址里不能包含用户名或密码'],
      ['https://192.0.2.10/basic.ics', '不能使用本机或内网地址'],
      ['https://intranet.example.com/basic.ics', '不能使用本机或内网地址'],
    ];

    // Act
    const messages = await Promise.all(cases.map(([url]) => inputError(service.saveCalendarUrl('alice', url))));
    lookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const unresolvable = await inputError(service.saveCalendarUrl('alice', 'https://missing.example.com/a.ics'));

    // Assert
    expect(messages).toEqual(cases.map(([, message]) => message));
    expect(unresolvable).toBe('无法解析这个地址的主机名');
    expect(store.put).not.toHaveBeenCalled();
    await expect(service.readCalendarSettings('alice')).resolves.toEqual({ configured: true, host: 'calendar.example.com' });
  });

  it('lets store failures through unchanged: they are not input errors, so the action answers 500', async () => {
    // Arrange
    const { service, store } = setup();
    store.put.mockRejectedValue(new CalendarStoreError());

    // Act
    const [saving, clearing] = await Promise.all([
      reasonOf(service.saveCalendarUrl('alice', OTHER_URL)),
      reasonOf(service.clearCalendarUrl('alice')),
    ]);

    // Assert
    for (const error of [saving, clearing]) {
      expect(error).toBeInstanceOf(CalendarStoreError);
      expect(error).not.toBeInstanceOf(ActionInputError);
    }
  });

  it('round-trips through the real settings file', async () => {
    // Arrange：真实的存储写在临时目录里
    const dir = await mkdtemp(path.join(tmpdir(), 'calendar-service-'));
    try {
      const store = createCalendarStore({ filePath: () => path.join(dir, 'nested', 'users.json') });
      const service = createCalendarService({ store, fetch: vi.fn<typeof fetch>(serve({ body: feed('A') })), lookup: lookupWith() });

      // Act
      const saved = await service.saveCalendarUrl('alice', SECRET_URL);
      const result = await service.getCalendarEvents('alice', MARCH, { timeZone: ZONE });
      const cleared = await service.clearCalendarUrl('alice');
      const afterClear = await service.readCalendarSettings('alice');

      // Assert
      expect(saved).toEqual({ configured: true, host: 'calendar.example.com' });
      expect(titles(result)).toEqual(['A']);
      expect(cleared).toEqual({ configured: false });
      expect(afterClear).toEqual({ configured: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('calendar logging', () => {
  const lines = () => logged.mock.calls.map((args) => args.join(' '));

  it('logs failures with the host only, never the path or query of the address', async () => {
    // Arrange：上游报错的消息里带着完整地址
    const cause = Object.assign(new TypeError(`fetch failed: ${SECRET_URL}`), { cause: { code: 'ECONNRESET' } });
    const { upstream, events } = setup({ reply: cause });

    // Act
    await events();
    upstream.mockImplementation(serve({ status: 500 }));
    await events();

    // Assert
    expect(lines()).toEqual([
      expect.stringContaining('[calendar] alice 的日历（calendar.example.com/…redacted）加载失败：无法连接日历服务器（network ECONNRESET）'),
      expect.stringContaining('[calendar] alice 的日历（calendar.example.com/…redacted）加载失败：日历服务器返回 HTTP 500（status 500）'),
    ]);
    for (const line of lines()) {
      expect(line).not.toContain(SECRET_PATH);
      expect(line).not.toContain(SECRET_TOKEN);
      expect(line).not.toContain('basic.ics');
    }
  });

  it('rethrows unexpected errors unchanged and logs only their type, never their message', async () => {
    // Arrange：取时间戳这种不该出错的地方出错，属于程序错误，不能当成上游失败显示给用户
    const thrown: readonly unknown[] = [new TypeError(`clock broke: ${SECRET_URL}`), `raw ${SECRET_TOKEN}`];

    // Act
    const reasons: unknown[] = [];
    for (const value of thrown) {
      const service = createCalendarService({
        store: memoryStore({ alice: SECRET_URL }),
        fetch: vi.fn<typeof fetch>(serve({ body: feed('A') })),
        lookup: lookupWith(),
        clock: () => {
          throw value;
        },
      });
      reasons.push(await reasonOf(service.getCalendarEvents('alice', MARCH, { timeZone: ZONE })));
    }

    // Assert
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toBe(thrown[0]);
    expect(reasons[1]).toBe(thrown[1]);
    expect(lines()).toEqual([
      expect.stringContaining('alice 的日历（calendar.example.com/…redacted）加载失败：TypeError'),
      expect.stringContaining('alice 的日历（calendar.example.com/…redacted）加载失败：string'),
    ]);
    for (const line of lines()) {
      expect(line).not.toContain(SECRET_PATH);
      expect(line).not.toContain(SECRET_TOKEN);
    }
  });

  it('reports data problems once per address, not on every request or refresh', async () => {
    // Arrange：一个没有 DTSTART 的条目；一个每小时重复、超过单个系列 2000 次上限的日程
    const body = calendar(
      vevent('UID:broken@test', 'SUMMARY:broken'),
      vevent('UID:hourly@test', 'DTSTART:20260301T000000Z', 'DURATION:PT10M', 'RRULE:FREQ=HOURLY', 'SUMMARY:hourly'),
    );
    const { advance, events } = setup({ reply: { body } });
    const spring: DateRange = { from: '2026-03-01', to: '2026-06-01' };

    // Act
    const first = await events('alice', spring);
    await events('alice', spring);
    advance(120_000);
    await events('alice', { from: '2026-03-02', to: '2026-06-02' });
    await vi.waitUntil(async () => {
      const result = await events('alice', spring);
      return result.status === 'ok' && result.fetchedAt > BASE_TIME;
    });

    // Assert
    expect(first.status === 'ok' && first.events.length).toBe(2000);
    expect(lines()).toEqual([
      expect.stringContaining('alice 的日历（calendar.example.com/…redacted）：有 1 个条目读不懂，已跳过'),
      expect.stringContaining('alice 的日历（calendar.example.com/…redacted）：日程太多，只显示了一部分'),
    ]);
  });
});
