import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../../src/adapters/calendar/model';
import { getCalendarEvents, readCalendarSettings } from '../../../src/adapters/calendar/service';
import { parseSite } from '../../../src/core/site';
import { monthData } from '../../../src/widgets/calendar/data';

vi.mock('../../../src/adapters/calendar/service', () => ({ getCalendarEvents: vi.fn(), readCalendarSettings: vi.fn() }));

// 上海 2026-09-29 12:00
const NOON = Date.UTC(2026, 8, 29, 4);
const at = (hour: number) => Date.UTC(2026, 8, 29, hour - 8);
const SETTINGS = { configured: true, host: 'calendar.example.com' } as const;

const EVENTS: readonly CalendarEvent[] = [
  { kind: 'timed', id: '组会', title: '组会', location: undefined, start: at(14), end: at(15) },
  // 国庆七天，格子只到 10 月 4 日
  { kind: 'all-day', id: '国庆', title: '国庆', location: undefined, startDate: '2026-10-01', endDate: '2026-10-08' },
];

const ctx = () => ({ user: 'alice', signal: new AbortController().signal, site: parseSite({}) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  vi.mocked(getCalendarEvents).mockReset().mockResolvedValue({ status: 'ok', events: EVENTS, stale: false, fetchedAt: NOON });
  vi.mocked(readCalendarSettings).mockReset().mockResolvedValue(SETTINGS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('calendar month data', () => {
  it('asks for the events of the whole grid, including the days padding the first and last week', async () => {
    const context = ctx();
    const data = await monthData({ year: 2026, month: 9 }, context);

    expect(data.grid.range).toEqual({ from: '2026-08-31', to: '2026-10-05' });
    expect(getCalendarEvents).toHaveBeenCalledWith('alice', data.grid.range, { timeZone: 'Asia/Shanghai', signal: context.signal });
    expect(readCalendarSettings).toHaveBeenCalledWith('alice');
    expect(data.settings).toEqual(SETTINGS);
  });

  it('marks today in the site time zone', async () => {
    // 上海已经是 10 月 1 日，UTC 还是 9 月 30 日
    vi.setSystemTime(Date.UTC(2026, 8, 30, 16, 30));
    const todayIn = async (timezone: string) => {
      const { grid } = await monthData({ year: 2026, month: 10 }, { ...ctx(), site: parseSite({ timezone }) });
      return grid.cells.filter((cell) => cell.today).map((cell) => cell.date);
    };

    expect(await todayIn('Asia/Shanghai')).toEqual(['2026-10-01']);
    // 9 月 30 日是 10 月格子开头补上的日子，照样标出今天
    expect(await todayIn('UTC')).toEqual(['2026-09-30']);
  });

  it('groups the events by day within the grid', async () => {
    const { feed } = await monthData({ year: 2026, month: 9 }, ctx());

    expect(feed.status).toBe('ok');
    if (feed.status !== 'ok') return;
    expect(Object.keys(feed.data)).toEqual(['2026-09-29', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(feed.data['2026-09-29']!.map((entry) => [entry.title, entry.time])).toEqual([['组会', '14:00']]);
    expect(feed.stale).toBe(false);
  });

  it('still draws the grid when the subscription is missing or failing', async () => {
    vi.mocked(getCalendarEvents).mockResolvedValueOnce({ status: 'error', message: '订阅地址无法访问' });
    vi.mocked(readCalendarSettings).mockResolvedValueOnce({ configured: false });

    const data = await monthData({ year: 2026, month: 11 }, ctx());

    expect(data.grid.key).toBe('2026-11');
    expect(data.grid.cells).toHaveLength(42);
    expect(data.grid.cells.some((cell) => cell.today)).toBe(false);
    expect(data.feed).toEqual({ status: 'error', message: '订阅地址无法访问' });
    expect(data.settings).toEqual({ configured: false });
  });
});
