import { describe, expect, it } from 'vitest';
import { ALL_DAY, CONTINUED, dayEntries, entriesByDay, eventSpan } from '../../../src/adapters/calendar/days';
import type { AllDayEvent, TimedEvent } from '../../../src/adapters/calendar/model';

const TZ = 'Asia/Shanghai';

// 东八区的墙上时间 → UTC 毫秒
const at = (wall: string) => Date.parse(`${wall}+08:00`);

function timed(id: string, start: string, end: string, location?: string): TimedEvent {
  return { kind: 'timed', id, title: `标题 ${id}`, location, start: at(start), end: at(end) };
}

function allDay(id: string, startDate: string, endDate: string): AllDayEvent {
  return { kind: 'all-day', id, title: `标题 ${id}`, location: undefined, startDate, endDate };
}

const times = (entries: readonly { id: string; time: string }[]) => entries.map(({ id, time }) => [id, time]);

describe('eventSpan', () => {
  it('ends an all-day event the day before its exclusive end date', () => {
    expect(eventSpan(allDay('week', '2026-10-01', '2026-10-08'), TZ)).toEqual({ first: '2026-10-01', last: '2026-10-07' });
    expect(eventSpan(allDay('day', '2026-09-30', '2026-10-01'), TZ)).toEqual({ first: '2026-09-30', last: '2026-09-30' });
  });

  it('treats an all-day event whose end is not after its start as a single day', () => {
    expect(eventSpan(allDay('bad', '2026-09-30', '2026-09-30'), TZ)).toEqual({ first: '2026-09-30', last: '2026-09-30' });
  });

  it('does not carry a timed event ending exactly at midnight into the next day', () => {
    expect(eventSpan(timed('late', '2026-09-30T22:00', '2026-10-01T00:00'), TZ)).toEqual({
      first: '2026-09-30',
      last: '2026-09-30',
    });
  });

  it('spans both days for an overnight event, and only the start day for a zero-length one', () => {
    expect(eventSpan(timed('night', '2026-09-30T23:00', '2026-10-01T01:00'), TZ).last).toBe('2026-10-01');
    expect(eventSpan(timed('point', '2026-09-30T10:00', '2026-09-30T10:00'), TZ).last).toBe('2026-09-30');
  });

  it('splits days in the site time zone rather than UTC', () => {
    // 东八区 9 月 30 日凌晨 2 点，是洛杉矶的 9 月 29 日上午
    const early = timed('early', '2026-09-30T02:00', '2026-09-30T03:00');

    expect(eventSpan(early, TZ).first).toBe('2026-09-30');
    expect(eventSpan(early, 'America/Los_Angeles').first).toBe('2026-09-29');
  });
});

describe('dayEntries', () => {
  it('lists all-day events first, then timed ones by start time in the site zone', () => {
    const events = [
      timed('dentist', '2026-09-30T14:00', '2026-09-30T15:00', '坪山人民医院'),
      timed('meeting', '2026-09-30T10:30', '2026-09-30T11:00'),
      allDay('holiday', '2026-09-30', '2026-10-01'),
    ];

    const entries = dayEntries(events, '2026-09-30', TZ);

    expect(times(entries)).toEqual([
      ['holiday', ALL_DAY],
      ['meeting', '10:30'],
      ['dentist', '14:00'],
    ]);
    expect(entries[0]).toMatchObject({ title: '标题 holiday', until: undefined, timing: undefined });
    expect(entries[2]).toMatchObject({
      location: '坪山人民医院',
      timing: { start: at('2026-09-30T14:00'), end: at('2026-09-30T15:00') },
    });
  });

  it('leaves out events on other days', () => {
    const events = [allDay('yesterday', '2026-09-29', '2026-09-30'), timed('tomorrow', '2026-10-01T09:00', '2026-10-01T10:00')];

    expect(dayEntries(events, '2026-09-30', TZ)).toEqual([]);
  });

  it('shows an overnight event carried over from the day before with a dash and its end time', () => {
    const flight = timed('flight', '2026-09-29T23:30', '2026-09-30T02:15');

    expect(dayEntries([flight], '2026-09-29', TZ)[0]).toMatchObject({ time: '23:30', until: undefined });
    expect(dayEntries([flight], '2026-09-30', TZ)[0]).toMatchObject({
      time: CONTINUED,
      until: '02:15',
      timing: { start: flight.start, end: flight.end },
    });
  });

  it('treats a timed event that fills the whole day as all-day, without timing', () => {
    const conference = timed('conf', '2026-09-29T09:00', '2026-10-01T18:00');

    expect(dayEntries([conference], '2026-09-29', TZ)[0]).toMatchObject({ time: '09:00' });
    expect(dayEntries([conference], '2026-09-30', TZ)[0]).toMatchObject({ time: ALL_DAY, until: undefined, timing: undefined });
    expect(dayEntries([conference], '2026-10-01', TZ)[0]).toMatchObject({ time: CONTINUED, until: '18:00' });
  });

  it('puts a carried-over event before the ones starting that day, and keeps the feed order for ties', () => {
    const events = [
      timed('first', '2026-09-30T09:00', '2026-09-30T10:00'),
      timed('second', '2026-09-30T09:00', '2026-09-30T10:00'),
      timed('overnight', '2026-09-29T22:00', '2026-09-30T08:00'),
    ];

    expect(dayEntries(events, '2026-09-30', TZ).map(({ id }) => id)).toEqual(['overnight', 'first', 'second']);
  });

  it('uses the real length of a day when daylight saving time ends', () => {
    // 马德里 2026-10-25 回拨一小时，这一天有 25 小时；到 23:30 结束的日程没有占满这一天
    const long = {
      ...timed('long', '2026-10-25T00:00', '2026-10-25T23:30'),
      start: Date.parse('2026-10-25T00:00+02:00'),
      end: Date.parse('2026-10-25T23:30+01:00'),
    };

    expect(dayEntries([long], '2026-10-25', 'Europe/Madrid')[0]).toMatchObject({ time: '00:00', until: undefined });
  });
});

describe('entriesByDay', () => {
  it('groups a range by day, leaving out the end date and days without events', () => {
    const events = [allDay('national', '2026-10-01', '2026-10-04'), timed('meeting', '2026-09-30T10:00', '2026-09-30T11:00')];

    const byDay = entriesByDay(events, { from: '2026-09-28', to: '2026-10-03' }, TZ);

    expect(Object.keys(byDay)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(times(byDay['2026-10-01'] ?? [])).toEqual([['national', ALL_DAY]]);
    expect(times(byDay['2026-09-30'] ?? [])).toEqual([['meeting', '10:00']]);
  });

  it('returns nothing for an empty or reversed range', () => {
    const events = [allDay('national', '2026-10-01', '2026-10-04')];

    expect(entriesByDay(events, { from: '2026-10-01', to: '2026-10-01' }, TZ)).toEqual({});
    expect(entriesByDay(events, { from: '2026-10-03', to: '2026-10-01' }, TZ)).toEqual({});
  });
});
