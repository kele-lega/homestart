import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarFeed } from '../../../src/adapters/calendar/model';
import { getCalendarEvents } from '../../../src/adapters/calendar/service';
import { parseSite } from '../../../src/core/site';
import agenda from '../../../src/widgets/agenda/widget';

vi.mock('../../../src/adapters/calendar/service', () => ({ getCalendarEvents: vi.fn() }));

// 上海 2026-09-29 12:00；上海没有夏令时，本地钟点减 8 小时就是 UTC
const NOON = Date.UTC(2026, 8, 29, 4);
const at = (hour: number, minute = 0) => Date.UTC(2026, 8, 29, hour - 8, minute);
const SITE = parseSite({});

const timed = (id: string, start: number, end: number, location?: string): CalendarEvent => ({
  kind: 'timed',
  id,
  title: id,
  location,
  start,
  end,
});

const load = () => agenda.load!(agenda.options.parse({}), { user: 'alice', signal: new AbortController().signal, site: SITE });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  vi.mocked(getCalendarEvents).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('agenda widget', () => {
  it('draws its own head and takes no options', () => {
    expect(agenda.head).toBe('view');
    expect(agenda.options.safeParse({ days: 2 }).success).toBe(false);
  });

  it("asks the calendar for today only and lists today's entries, all-day first", async () => {
    const events: readonly CalendarEvent[] = [
      timed('组会', at(14), at(15), '三楼'),
      { kind: 'all-day', id: '中秋', title: '中秋', location: undefined, startDate: '2026-09-29', endDate: '2026-09-30' },
      timed('早饭', at(8), at(8, 30)),
    ];
    vi.mocked(getCalendarEvents).mockResolvedValue({ status: 'ok', events, stale: true, fetchedAt: NOON } satisfies CalendarFeed);

    const data = await load();

    expect(vi.mocked(getCalendarEvents).mock.calls[0]!.slice(0, 2)).toEqual(['alice', { from: '2026-09-29', to: '2026-09-30' }]);
    expect(data.status).toBe('ok');
    if (data.status !== 'ok') return;
    expect(data.stale).toBe(true);
    expect(data.data.map((entry) => [entry.title, entry.time, entry.location])).toEqual([
      ['中秋', '全天', undefined],
      ['早饭', '08:00', undefined],
      ['组会', '14:00', '三楼'],
    ]);
    expect(data.data[2]!.timing).toEqual({ start: at(14), end: at(15) });
  });

  it('passes an unconfigured or failed subscription through unchanged', async () => {
    vi.mocked(getCalendarEvents).mockResolvedValueOnce({ status: 'unconfigured' });
    await expect(load()).resolves.toEqual({ status: 'unconfigured' });

    vi.mocked(getCalendarEvents).mockResolvedValueOnce({ status: 'error', message: '日历格式不对' });
    await expect(load()).resolves.toEqual({ status: 'error', message: '日历格式不对' });
  });
});
