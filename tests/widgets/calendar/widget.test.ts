import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalEvent, removeLocalEvent, updateLocalEvent } from '../../../src/adapters/calendar/local-events';
import { syncNow } from '../../../src/adapters/calendar/google-sync';
import { parseSite } from '../../../src/core/site';
import { ActionInputError } from '../../../src/core/widget';
import { monthData, type MonthData } from '../../../src/widgets/calendar/data';
import calendar from '../../../src/widgets/calendar/widget';

vi.mock('../../../src/widgets/calendar/data', () => ({ monthData: vi.fn() }));
// 不碰真实的同步设置文件；默认当作没连 Google
vi.mock('../../../src/adapters/calendar/google-sync', () => ({ syncNow: vi.fn(async () => undefined) }));
vi.mock('../../../src/adapters/calendar/local-events', async (original) => ({
  ...(await original<typeof import('../../../src/adapters/calendar/local-events')>()),
  createLocalEvent: vi.fn(async () => ({ id: 'local:new' })),
  updateLocalEvent: vi.fn(async (_user: string, id: string) => ({ id })),
  removeLocalEvent: vi.fn(async () => undefined),
}));

const { month, create, update, remove } = calendar.actions!;
const FIELDS = {
  title: '牙医',
  location: '',
  allDay: false,
  startDate: '2026-10-08',
  startTime: '09:00',
  endDate: '2026-10-08',
  endTime: '10:00',
};
const ctx = <B>(body: B) => ({ user: 'alice', signal: new AbortController().signal, site: parseSite({}), body });
const MONTH = { grid: { key: '2026-10' } } as unknown as MonthData;

beforeEach(() => {
  vi.mocked(monthData).mockReset().mockResolvedValue(MONTH);
});

describe('calendar widget', () => {
  it('draws its own head and takes no options', () => {
    expect(calendar.head).toBe('view');
    expect(calendar.options.safeParse({ weeks: 6 }).success).toBe(false);
  });

  it('reads months with GET and writes only its own events; the subscription moved to /api/settings/calendar', () => {
    expect(Object.keys(calendar.actions!)).toEqual(['month', 'create', 'update', 'remove', 'sync']);
    expect(month!.method ?? 'GET').toBe('GET');
    expect(month!.body).toBeUndefined();
    expect([create!.method, update!.method, remove!.method, calendar.actions!.sync!.method]).toEqual(['POST', 'PUT', 'DELETE', 'POST']);
  });
});

describe('calendar event actions', () => {
  it('creates, updates and removes events of the signed-in user', async () => {
    const body = create!.body!.parse(FIELDS);
    await expect(create!.run({}, {}, ctx(body))).resolves.toEqual({ id: 'local:new' });
    await expect(update!.run({}, update!.query.parse({ id: 'local:abc' }), ctx(body))).resolves.toEqual({ id: 'local:abc' });
    await expect(remove!.run({}, remove!.query.parse({ id: 'local:abc' }), ctx(undefined))).resolves.toEqual({ id: 'local:abc' });

    expect(createLocalEvent).toHaveBeenCalledWith('alice', FIELDS);
    expect(updateLocalEvent).toHaveBeenCalledWith('alice', 'local:abc', FIELDS);
    expect(removeLocalEvent).toHaveBeenCalledWith('alice', 'local:abc');
    expect(syncNow).toHaveBeenCalledTimes(3);
  });

  it('reports what is still waiting for Google Calendar when connected', async () => {
    vi.mocked(syncNow).mockResolvedValueOnce(2);
    await expect(create!.run({}, {}, ctx(create!.body!.parse(FIELDS)))).resolves.toEqual({ id: 'local:new', pending: 2 });
  });

  it('refuses ids from the subscription and unknown fields', () => {
    expect(update!.query.safeParse({ id: 'uid-from-google@example.com' }).success).toBe(false);
    expect(create!.body!.safeParse({ ...FIELDS, color: 'red' }).success).toBe(false);
  });
});

describe('calendar month action', () => {
  it('loads the requested month with the request context', async () => {
    const context = ctx(undefined);
    await expect(month!.run({}, month!.query.parse({ month: '2026-10' }), context)).resolves.toBe(MONTH);

    expect(monthData).toHaveBeenCalledWith({ year: 2026, month: 10 }, context);
  });

  it('rejects a missing month in the query', () => {
    expect(month!.query.safeParse({}).success).toBe(false);
  });

  it('rejects malformed or out-of-range months with one readable message', async () => {
    for (const raw of ['2026-1', '2026-13', '1900-12', '2100-01', 'next']) {
      const run = month!.run({}, { month: raw }, ctx(undefined));
      await expect(run, raw).rejects.toBeInstanceOf(ActionInputError);
      await expect(month!.run({}, { month: raw }, ctx(undefined))).rejects.toThrow('月份格式为 YYYY-MM，只支持 1901 至 2099 年');
    }
    expect(monthData).not.toHaveBeenCalled();
  });
});
