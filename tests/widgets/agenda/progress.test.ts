import { describe, expect, it } from 'vitest';
import { isDone, nextIndex } from '../../../src/widgets/agenda/progress';

const at = (wall: string) => Date.parse(`2026-09-30T${wall}+08:00`);
const span = (start: string, end: string) => ({ start: at(start), end: at(end) });

describe('isDone', () => {
  it('is done once the end has passed, not while the event is running', () => {
    const meeting = span('10:30', '11:00');

    expect(isDone(meeting, at('10:45'))).toBe(false);
    expect(isDone(meeting, at('11:00'))).toBe(true);
  });

  it('treats a zero-length event as done from its start', () => {
    const reminder = span('09:00', '09:00');

    expect(isDone(reminder, at('08:59'))).toBe(false);
    expect(isDone(reminder, at('09:00'))).toBe(true);
  });
});

describe('nextIndex', () => {
  const timings = [undefined, span('08:00', '09:00'), span('10:30', '11:00'), span('14:00', '15:00')];

  it('skips all-day entries and finished ones, counting the running event as next', () => {
    expect(nextIndex(timings, at('07:00'))).toBe(1);
    expect(nextIndex(timings, at('10:40'))).toBe(2);
    expect(nextIndex(timings, at('11:00'))).toBe(3);
  });

  it('returns -1 when everything is over or there is nothing timed', () => {
    expect(nextIndex(timings, at('15:00'))).toBe(-1);
    expect(nextIndex([undefined, undefined], at('07:00'))).toBe(-1);
  });
});
