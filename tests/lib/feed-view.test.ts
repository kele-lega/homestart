import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../src/adapters/calendar/model';
import { feedNotice, mapFeed } from '../../src/lib/feed-view';

const EVENT: CalendarEvent = {
  kind: 'all-day',
  id: 'a',
  title: '中秋',
  location: undefined,
  startDate: '2026-09-25',
  endDate: '2026-09-26',
};

describe('mapFeed', () => {
  it('maps the events of a working subscription and keeps the stale flag', () => {
    const view = mapFeed({ status: 'ok', events: [EVENT], stale: true, fetchedAt: 0 }, (events) => events.map((event) => event.title));

    expect(view).toEqual({ status: 'ok', data: ['中秋'], stale: true });
  });

  it('passes a missing or failed subscription through without mapping', () => {
    const toData = vi.fn();

    expect(mapFeed({ status: 'unconfigured' }, toData)).toEqual({ status: 'unconfigured' });
    expect(mapFeed({ status: 'error', message: '日历格式不对' }, toData)).toEqual({ status: 'error', message: '日历格式不对' });
    expect(toData).not.toHaveBeenCalled();
  });
});

describe('feedNotice', () => {
  it('explains a missing subscription, a failure and stale data', () => {
    expect(feedNotice({ status: 'unconfigured' })).toEqual({ kind: 'unconfigured', text: expect.stringContaining('还没有订阅日历') });
    expect(feedNotice({ status: 'error', message: '日历格式不对' })).toEqual({ kind: 'error', text: '日历读取失败：日历格式不对' });
    expect(feedNotice({ status: 'ok', data: [], stale: true })).toEqual({ kind: 'stale', text: expect.stringContaining('上次读到的日程') });
  });

  it('stays quiet when the data is fresh', () => {
    expect(feedNotice({ status: 'ok', data: [], stale: false })).toBeUndefined();
  });
});
