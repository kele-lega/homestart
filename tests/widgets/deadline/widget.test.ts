import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarFeed } from '../../../src/adapters/calendar/model';
import { getCalendarEvents } from '../../../src/adapters/calendar/service';
import { parseSite } from '../../../src/core/site';
import deadline from '../../../src/widgets/deadline/widget';

vi.mock('../../../src/adapters/calendar/service', async (importOriginal) => ({
  MAX_RANGE_DAYS: (await importOriginal<typeof import('../../../src/adapters/calendar/service')>()).MAX_RANGE_DAYS,
  getCalendarEvents: vi.fn(),
}));

// 上海 2026-09-29 12:00
const NOON = Date.UTC(2026, 8, 29, 4);
const SITE = parseSite({});

const allDay = (id: string, startDate: string, endDate: string): CalendarEvent => ({
  kind: 'all-day',
  id,
  title: id,
  location: undefined,
  startDate,
  endDate,
});

const okFeed = (events: readonly CalendarEvent[]): CalendarFeed => ({ status: 'ok', events, stale: false, fetchedAt: NOON });

const load = (raw: unknown, user = 'alice') =>
  deadline.load!(deadline.options.parse(raw), { user, signal: new AbortController().signal, site: SITE });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  vi.mocked(getCalendarEvents).mockReset().mockResolvedValue(okFeed([]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deadline options', () => {
  it('lists five items over the next 90 days by default', () => {
    expect(deadline.options.parse({})).toEqual({ max: 5, days: 90 });
  });

  it('rejects out-of-range counts, windows and unknown keys', () => {
    const invalid = [{ max: 0 }, { max: 21 }, { max: 1.5 }, { days: 0 }, { days: 801 }, { limit: 3 }];
    for (const raw of invalid) {
      expect(deadline.options.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
  });
});

describe('deadline load', () => {
  it('asks the calendar for the configured window, starting today in the site time zone', async () => {
    await load({ days: 30 });

    expect(getCalendarEvents).toHaveBeenCalledWith(
      'alice',
      { from: '2026-09-29', to: '2026-10-29' },
      expect.objectContaining({ timeZone: 'Asia/Shanghai', signal: expect.any(AbortSignal) }),
    );
  });

  it('starts from the next day once the site time zone has passed midnight', async () => {
    vi.setSystemTime(Date.UTC(2026, 8, 29, 16, 30));
    await load({ days: 1 });

    expect(vi.mocked(getCalendarEvents).mock.calls[0]![1]).toEqual({ from: '2026-09-30', to: '2026-10-01' });
  });

  it('turns the events into rows, nearest first and capped at max', async () => {
    vi.mocked(getCalendarEvents).mockResolvedValue(
      okFeed([allDay('续费', '2026-10-01', '2026-10-02'), allDay('交稿', '2026-09-29', '2026-09-30'), allDay('体检', '2026-10-09', '2026-10-10')]),
    );

    const data = await load({ max: 2 });

    expect(data.status).toBe('ok');
    if (data.status !== 'ok') return;
    expect(data.data.map((row) => [row.title, row.daysLeft, row.note])).toEqual([
      ['交稿', 0, '今天截止'],
      ['续费', 2, '后天截止'],
    ]);
    expect(data.stale).toBe(false);
  });

  it('passes an unconfigured or failed subscription through unchanged', async () => {
    vi.mocked(getCalendarEvents).mockResolvedValueOnce({ status: 'unconfigured' });
    await expect(load({})).resolves.toEqual({ status: 'unconfigured' });

    vi.mocked(getCalendarEvents).mockResolvedValueOnce({ status: 'error', message: '订阅地址无法访问' });
    await expect(load({})).resolves.toEqual({ status: 'error', message: '订阅地址无法访问' });
  });
});
