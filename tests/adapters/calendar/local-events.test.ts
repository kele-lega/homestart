import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalEvents,
  createLocalEventsStore,
  eventsInRange,
  toCalendarEvent,
  type StoredEvent,
} from '../../../src/adapters/calendar/local-events';
import { ANONYMOUS } from '../../../src/core/api';
import { ActionInputError } from '../../../src/core/widget';
import type { EventFields } from '../../../src/lib/event-fields';

const ZONE = 'Asia/Shanghai';
const FIELDS: EventFields = {
  title: '  组会  ',
  location: ' 三楼 ',
  allDay: false,
  startDate: '2026-03-12',
  startTime: '09:00',
  endDate: '2026-03-12',
  endTime: '10:30',
};

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'local-events-'));
  file = path.join(dir, 'calendar-events.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function service() {
  let n = 0;
  return createLocalEvents({ store: createLocalEventsStore(() => file), clock: () => 1000, newId: () => `id-${++n}` });
}

describe('local events', () => {
  it('saves per account in a private file, so every device of the same account sees it', async () => {
    const one = service();
    const created = await one.create('alice', FIELDS);

    // 另一个进程（另一台设备的请求）读同一个文件
    const other = service();
    expect(await other.list('alice')).toEqual([created]);
    expect(await other.list('bob')).toEqual([]);
    expect(created).toMatchObject({ id: 'local:id-1', title: '组会', location: '三楼', updatedAt: 1000 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ alice: [created] });
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('updates and removes by id, and drops the user entry when the last one goes', async () => {
    const events = service();
    const { id } = await events.create('alice', FIELDS);

    const changed = await events.update('alice', id, { ...FIELDS, allDay: true, endDate: '2026-03-13' });
    expect(changed).toMatchObject({ id, allDay: true, startTime: '', endTime: '' });
    await events.remove('alice', id);

    expect(await events.list('alice')).toEqual([]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({});
  });

  it('keeps concurrent creates instead of losing one', async () => {
    const events = service();
    await Promise.all([events.create('alice', FIELDS), events.create('alice', FIELDS), events.create('alice', FIELDS)]);

    expect(await events.list('alice')).toHaveLength(3);
  });

  it('rejects bad input, unknown ids and visitors with a message for the user', async () => {
    const events = service();

    await expect(events.create('alice', { ...FIELDS, title: '  ' })).rejects.toThrow(new ActionInputError('请填写标题'));
    await expect(events.create('alice', { ...FIELDS, endTime: '08:00' })).rejects.toThrow('结束时间不能早于开始时间');
    await expect(events.create('alice', { ...FIELDS, endDate: '2026-03-11' })).rejects.toThrow('结束日期不能早于开始日期');
    await expect(events.update('alice', 'local:nope', FIELDS)).rejects.toThrow('已经不在了');
    await expect(events.create(ANONYMOUS, FIELDS)).rejects.toThrow('登录后才能添加日程');
    expect(await events.list(ANONYMOUS)).toEqual([]);
  });
});

describe('toCalendarEvent / eventsInRange', () => {
  const stored = (fields: Partial<EventFields>, id = 'local:x'): StoredEvent => ({ ...FIELDS, ...fields, id, updatedAt: 0 });

  it('reads the wall time in the site time zone; all-day end dates become exclusive', () => {
    expect(toCalendarEvent(stored({ title: '组会' }), ZONE)).toEqual({
      kind: 'timed',
      id: 'local:x',
      title: '组会',
      location: '三楼',
      start: Date.UTC(2026, 2, 12, 1),
      end: Date.UTC(2026, 2, 12, 2, 30),
    });
    expect(toCalendarEvent(stored({ allDay: true, location: '' }), ZONE)).toMatchObject({
      kind: 'all-day',
      startDate: '2026-03-12',
      endDate: '2026-03-13',
      location: undefined,
    });
  });

  it('keeps only events that touch the range', () => {
    const list = [
      stored({ startDate: '2026-02-27', endDate: '2026-03-01', endTime: '10:00' }, 'local:spans-in'),
      stored({ startDate: '2026-02-20', endDate: '2026-02-20' }, 'local:before'),
      stored({ startDate: '2026-04-01', endDate: '2026-04-01' }, 'local:after'),
    ];

    expect(eventsInRange(list, { from: '2026-03-01', to: '2026-04-01' }, ZONE).map((event) => event.id)).toEqual(['local:spans-in']);
  });
});
