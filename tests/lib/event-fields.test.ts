import { describe, expect, it } from 'vitest';
import { draftFields, fieldsProblem, moveStart, type EventFields } from '../../src/lib/event-fields';

const BASE: EventFields = {
  title: '组会',
  location: '',
  allDay: false,
  startDate: '2026-03-12',
  startTime: '09:00',
  endDate: '2026-03-12',
  endTime: '10:30',
};

describe('draftFields', () => {
  it('starts at the next full hour today and at 9 on other days, for one hour', () => {
    expect(draftFields('2026-03-12', '2026-03-12', '14:20')).toMatchObject({ startTime: '15:00', endTime: '16:00' });
    expect(draftFields('2026-03-20', '2026-03-12', '14:20')).toMatchObject({ startTime: '09:00', endTime: '10:00' });
    expect(draftFields('2026-03-12', '2026-03-12', '23:10')).toMatchObject({ startTime: '23:00', endTime: '23:59' });
  });
});

describe('moveStart', () => {
  it('moves the end along and keeps the duration, across midnight too', () => {
    expect(moveStart(BASE, { date: '2026-03-12', time: '23:00' })).toMatchObject({ endDate: '2026-03-13', endTime: '00:30' });
    expect(moveStart(BASE, { date: '2026-03-20', time: '09:00' })).toMatchObject({ endDate: '2026-03-20', endTime: '10:30' });
  });

  it('keeps the number of days for all-day events', () => {
    const allDay = { ...BASE, allDay: true, endDate: '2026-03-14' };
    expect(moveStart(allDay, { date: '2026-04-01', time: '' })).toMatchObject({ startDate: '2026-04-01', endDate: '2026-04-03' });
  });

  it('leaves the end alone while the start is half typed', () => {
    expect(moveStart(BASE, { date: '', time: '09:00' })).toMatchObject({ startDate: '', endDate: '2026-03-12' });
  });
});

describe('fieldsProblem', () => {
  it('accepts a normal event and explains what is wrong otherwise', () => {
    expect(fieldsProblem(BASE)).toBeUndefined();
    expect(fieldsProblem({ ...BASE, title: '' })).toBe('请填写标题');
    expect(fieldsProblem({ ...BASE, startTime: '9:00' })).toBe('时间格式为 HH:mm');
    expect(fieldsProblem({ ...BASE, endDate: '2027-03-13' })).toContain('最长');
    // 全天日程不看钟点
    expect(fieldsProblem({ ...BASE, allDay: true, startTime: '', endTime: '' })).toBeUndefined();
  });
});
