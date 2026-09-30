import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCalendarUrl, saveCalendarUrl } from '../../../src/adapters/calendar/service';
import { parseSite } from '../../../src/core/site';
import { ActionInputError } from '../../../src/core/widget';
import { monthData, type MonthData } from '../../../src/widgets/calendar/data';
import calendar from '../../../src/widgets/calendar/widget';

vi.mock('../../../src/adapters/calendar/service', () => ({ saveCalendarUrl: vi.fn(), clearCalendarUrl: vi.fn() }));
vi.mock('../../../src/widgets/calendar/data', () => ({ monthData: vi.fn() }));

const { month, subscribe, unsubscribe } = calendar.actions!;
const ctx = <B>(body: B) => ({ user: 'alice', signal: new AbortController().signal, site: parseSite({}), body });
const MONTH = { grid: { key: '2026-10' } } as unknown as MonthData;

beforeEach(() => {
  vi.mocked(monthData).mockReset().mockResolvedValue(MONTH);
  vi.mocked(saveCalendarUrl).mockReset().mockResolvedValue({ configured: true, host: 'calendar.example.com' });
  vi.mocked(clearCalendarUrl).mockReset().mockResolvedValue({ configured: false });
});

describe('calendar widget', () => {
  it('draws its own head and takes no options', () => {
    expect(calendar.head).toBe('view');
    expect(calendar.options.safeParse({ weeks: 6 }).success).toBe(false);
  });

  it('reads months with GET and changes the subscription with PUT and DELETE', () => {
    expect(month!.method ?? 'GET').toBe('GET');
    expect(month!.body).toBeUndefined();
    expect(subscribe!.method).toBe('PUT');
    expect(subscribe!.body!.safeParse({}).success).toBe(false);
    expect(unsubscribe!.method).toBe('DELETE');
    expect(unsubscribe!.body).toBeUndefined();
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

describe('calendar subscription actions', () => {
  it("saves the address for the signed-in user and answers with the host only", async () => {
    const result = await subscribe!.run({}, {}, ctx({ url: 'https://calendar.example.com/private/basic.ics' }));

    expect(saveCalendarUrl).toHaveBeenCalledWith('alice', 'https://calendar.example.com/private/basic.ics');
    expect(result).toEqual({ configured: true, host: 'calendar.example.com' });
  });

  it("clears the signed-in user's subscription", async () => {
    await expect(unsubscribe!.run({}, {}, ctx(undefined))).resolves.toEqual({ configured: false });
    expect(clearCalendarUrl).toHaveBeenCalledWith('alice');
  });
});
