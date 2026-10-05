import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, expandFeed, type ExpandLimits } from '../../../src/adapters/calendar/expand';
import type { CalendarEvent } from '../../../src/adapters/calendar/model';
import { parseFeed, type ParsedFeed } from '../../../src/adapters/calendar/parse';
import { calendar, MADRID, vevent } from './ics';

function expand(source: string | ParsedFeed, from: string, to: string, limits: Partial<ExpandLimits> = {}, timeZone = 'Asia/Shanghai') {
  const feed = typeof source === 'string' ? parseFeed(source) : source;
  return expandFeed(feed, { from, to, timeZone }, { ...DEFAULT_LIMITS, ...limits });
}

const iso = (ms: number) => new Date(ms).toISOString().replace(':00.000Z', 'Z');

/** 简写：全天 '开始..结束 标题'，定时 'UTC 开始..UTC 结束 标题' */
function brief(event: CalendarEvent): string {
  return event.kind === 'all-day'
    ? `${event.startDate}..${event.endDate} ${event.title}`
    : `${iso(event.start)}..${iso(event.end)} ${event.title}`;
}

describe('expandFeed：单次日程', () => {
  it('全天：DTEND 不含、DURATION、缺省一天、结束写反按一天；窗口前开始的也算', () => {
    // Arrange
    const text = calendar(
      vevent('UID:a', 'SUMMARY:Spans in', 'DTSTART;VALUE=DATE:20260308', 'DTEND;VALUE=DATE:20260311'),
      vevent('UID:b', 'SUMMARY:One day', 'DTSTART;VALUE=DATE:20260310'),
      vevent('UID:c', 'SUMMARY:Two days', 'DTSTART;VALUE=DATE:20260311', 'DURATION:P2D'),
      vevent('UID:d', 'SUMMARY:Bad end', 'DTSTART;VALUE=DATE:20260312', 'DTEND;VALUE=DATE:20260301'),
      vevent('UID:e', 'SUMMARY:Ended', 'DTSTART;VALUE=DATE:20260309', 'DTEND;VALUE=DATE:20260310'),
      vevent('UID:f', 'SUMMARY:After', 'DTSTART;VALUE=DATE:20260320'),
    );

    // Act
    const { events } = expand(text, '2026-03-10', '2026-03-17');

    // Assert
    expect(events.map(brief)).toEqual([
      '2026-03-08..2026-03-11 Spans in',
      '2026-03-10..2026-03-11 One day',
      '2026-03-11..2026-03-13 Two days',
      '2026-03-12..2026-03-13 Bad end',
    ]);
    expect(events[1].id).toBe('b@2026-03-10');
  });

  it('定时：换算到 UTC；没有结束的零时长，落在窗口起点也算；恰好在起点结束的不算', () => {
    // 窗口 [03-10, 03-11) 在上海是 [03-09T16:00Z, 03-10T16:00Z)
    const text = calendar(
      MADRID,
      vevent('UID:a', 'SUMMARY:Madrid', 'DTSTART;TZID=Europe/Madrid:20260310T100000', 'DTEND;TZID=Europe/Madrid:20260310T113000'),
      vevent('UID:b', 'SUMMARY:Floating', 'DTSTART:20260310T080000', 'DURATION:PT1H'),
      vevent('UID:c', 'SUMMARY:Point at start', 'DTSTART:20260309T160000Z'),
      vevent('UID:d', 'SUMMARY:Ends at start', 'DTSTART:20260309T150000Z', 'DTEND:20260309T160000Z'),
      vevent('UID:e', 'SUMMARY:Reversed', 'DTSTART:20260310T120000Z', 'DTEND:20260310T110000Z'),
      vevent('UID:f', 'SUMMARY:Point at end', 'DTSTART:20260310T160000Z'),
    );

    // Act
    const { events } = expand(text, '2026-03-10', '2026-03-11');

    // Assert
    expect(events.map(brief)).toEqual([
      '2026-03-09T16:00Z..2026-03-09T16:00Z Point at start',
      '2026-03-10T00:00Z..2026-03-10T01:00Z Floating',
      '2026-03-10T09:00Z..2026-03-10T10:30Z Madrid',
      '2026-03-10T12:00Z..2026-03-10T12:00Z Reversed',
    ]);
    expect(events[0].id).toBe('c@2026-03-09T16:00:00.000Z');
  });
});

describe('expandFeed：重复日程', () => {
  it('每周 + COUNT + EXDATE + RDATE，跨马德里夏令时按当地时间走', () => {
    // Arrange：03-29 起夏令时，当地 10:00 从 09:00Z 变成 08:00Z
    const text = calendar(
      MADRID,
      vevent(
        'UID:w', 'SUMMARY:Weekly',
        'DTSTART;TZID=Europe/Madrid:20260302T100000', 'DTEND;TZID=Europe/Madrid:20260302T110000',
        'RRULE:FREQ=WEEKLY;COUNT=6',
        'EXDATE;TZID=Europe/Madrid:20260316T100000',
        'RDATE;TZID=Europe/Madrid:20260325T150000',
      ),
    );

    // Act
    const { events, issues } = expand(text, '2026-03-10', '2026-04-10');

    // Assert
    expect(events.map(brief)).toEqual([
      '2026-03-23T09:00Z..2026-03-23T10:00Z Weekly',
      '2026-03-25T14:00Z..2026-03-25T15:00Z Weekly',
      '2026-03-30T08:00Z..2026-03-30T09:00Z Weekly',
      '2026-04-06T08:00Z..2026-04-06T09:00Z Weekly',
    ]);
    expect(events[0].id).toBe('w@2026-03-23T09:00:00.000Z');
    expect(issues).toEqual({ timeout: 0, invalid: 0, truncated: false });
  });

  it('改过的那一次沿用原 id、换成新时间；取消的那一次不出现', () => {
    // Arrange
    const text = calendar(
      MADRID,
      vevent('UID:w', 'SUMMARY:Weekly', 'DTSTART;TZID=Europe/Madrid:20260302T100000', 'DTEND;TZID=Europe/Madrid:20260302T110000', 'RRULE:FREQ=WEEKLY;COUNT=4'),
      vevent('UID:w', 'SUMMARY:Moved', 'RECURRENCE-ID;TZID=Europe/Madrid:20260309T100000', 'DTSTART;TZID=Europe/Madrid:20260311T140000', 'DTEND;TZID=Europe/Madrid:20260311T150000'),
      vevent('UID:w', 'STATUS:CANCELLED', 'RECURRENCE-ID;TZID=Europe/Madrid:20260316T100000', 'DTSTART;TZID=Europe/Madrid:20260316T100000'),
    );

    // Act
    const { events } = expand(text, '2026-03-09', '2026-03-23');

    // Assert
    expect(events.map(brief)).toEqual(['2026-03-11T13:00Z..2026-03-11T14:00Z Moved']);
    expect(events[0].id).toBe('w@2026-03-09T09:00:00.000Z');
  });

  it('THISANDFUTURE：从那一次起都按新的时差和标题', () => {
    // Arrange：03-09 起每次推迟 2 小时、改名
    const text = calendar(
      MADRID,
      vevent('UID:w', 'SUMMARY:Weekly', 'DTSTART;TZID=Europe/Madrid:20260302T100000', 'DTEND;TZID=Europe/Madrid:20260302T110000', 'RRULE:FREQ=WEEKLY;COUNT=4'),
      vevent(
        'UID:w', 'SUMMARY:Late', 'RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=Europe/Madrid:20260309T100000',
        'DTSTART;TZID=Europe/Madrid:20260309T120000', 'DTEND;TZID=Europe/Madrid:20260309T130000',
      ),
    );

    // Act
    const { events } = expand(text, '2026-03-01', '2026-03-24');

    // Assert
    expect(events.map(brief)).toEqual([
      '2026-03-02T09:00Z..2026-03-02T10:00Z Weekly',
      '2026-03-09T11:00Z..2026-03-09T12:00Z Late',
      '2026-03-16T11:00Z..2026-03-16T12:00Z Late',
      '2026-03-23T11:00Z..2026-03-23T12:00Z Late',
    ]);
    expect(events.map((event) => event.id)).toEqual([
      'w@2026-03-02T09:00:00.000Z',
      'w@2026-03-09T09:00:00.000Z',
      'w@2026-03-16T09:00:00.000Z',
      'w@2026-03-23T09:00:00.000Z',
    ]);
  });

  it('RECURRENCE-ID 写成 UTC 也能对上马德里时间的那一次', () => {
    // Arrange
    const text = calendar(
      MADRID,
      vevent('UID:w', 'SUMMARY:Weekly', 'DTSTART;TZID=Europe/Madrid:20260302T100000', 'DTEND;TZID=Europe/Madrid:20260302T110000', 'RRULE:FREQ=WEEKLY;COUNT=2'),
      vevent('UID:w', 'SUMMARY:Moved', 'RECURRENCE-ID:20260309T090000Z', 'DTSTART:20260309T130000Z', 'DTEND:20260309T140000Z'),
    );

    // Act
    const { events } = expand(text, '2026-03-01', '2026-03-31');

    // Assert
    expect(events.map(brief)).toEqual([
      '2026-03-02T09:00Z..2026-03-02T10:00Z Weekly',
      '2026-03-09T13:00Z..2026-03-09T14:00Z Moved',
    ]);
  });

  it('只写 IANA TZID、不带 VTIMEZONE 照样换算；浮动时间跟站点时区走', () => {
    // Arrange：东京 09:00 即 00:00Z，没有结束的零时长
    const text = calendar(
      vevent('UID:t', 'SUMMARY:Tokyo', 'DTSTART;TZID=Asia/Tokyo:20260309T090000', 'RRULE:FREQ=DAILY;COUNT=3'),
      vevent('UID:f', 'SUMMARY:Floating', 'DTSTART:20260310T090000', 'DTEND:20260310T100000', 'RRULE:FREQ=DAILY;COUNT=2'),
    );

    // Act
    const shanghai = expand(text, '2026-03-10', '2026-03-11');
    const london = expand(text, '2026-03-10', '2026-03-11', {}, 'Europe/London');

    // Assert
    expect(shanghai.events.map(brief)).toEqual([
      '2026-03-10T00:00Z..2026-03-10T00:00Z Tokyo',
      '2026-03-10T01:00Z..2026-03-10T02:00Z Floating',
    ]);
    expect(london.events.map(brief)).toEqual([
      '2026-03-10T00:00Z..2026-03-10T00:00Z Tokyo',
      '2026-03-10T09:00Z..2026-03-10T10:00Z Floating',
    ]);
  });
});

describe('expandFeed：排序与 id', () => {
  it('同一时刻全天在前、再按标题；同 UID 同时间的重复条目 id 加 #2', () => {
    // Arrange：上海 03-10 零点即 03-09T16:00Z
    const text = calendar(
      vevent('UID:late', 'SUMMARY:Later', 'DTSTART:20260310T010000Z'),
      vevent('UID:dup', 'SUMMARY:B', 'DTSTART:20260309T160000Z'),
      vevent('UID:dup', 'SUMMARY:A', 'DTSTART:20260309T160000Z'),
      vevent('UID:all', 'SUMMARY:Z all day', 'DTSTART;VALUE=DATE:20260310'),
    );

    // Act
    const { events } = expand(text, '2026-03-10', '2026-03-11');

    // Assert
    expect(events.map((event) => `${event.id} ${event.title}`)).toEqual([
      'all@2026-03-10 Z all day',
      'dup@2026-03-09T16:00:00.000Z A',
      'dup@2026-03-09T16:00:00.000Z#2 B',
      'late@2026-03-10T01:00:00.000Z Later',
    ]);
  });
});

describe('expandFeed：上限', () => {
  const dailyEvent = vevent('UID:d', 'SUMMARY:Daily', 'DTSTART:20260301T090000Z', 'DTEND:20260301T100000Z', 'RRULE:FREQ=DAILY');
  const daily = calendar(dailyEvent);

  it('不超上限时全部展开，不算截断', () => {
    // Act
    const { events, issues } = expand(daily, '2026-03-01', '2026-04-01');

    // Assert
    expect(events).toHaveLength(31);
    expect(issues.truncated).toBe(false);
  });

  it.each([
    ['maxEventsPerSeries', { maxEventsPerSeries: 5 }, 5],
    ['maxEvents', { maxEvents: 3 }, 3],
    ['maxStepsPerSeries', { maxStepsPerSeries: 4 }, 4],
    ['maxSteps', { maxSteps: 2 }, 2],
  ] as const)('%s 截断并标记', (_name, limits, count) => {
    // Act
    const { events, issues } = expand(daily, '2026-03-01', '2026-04-01', limits);

    // Assert
    expect(events).toHaveLength(count);
    expect(events[0].title).toBe('Daily');
    expect(issues.truncated).toBe(true);
  });

  it('总预算用完：单次日程照常，重复日程不再展开', () => {
    // Arrange
    const feed = parseFeed(calendar(dailyEvent, vevent('UID:s', 'SUMMARY:Single', 'DTSTART:20260310T090000Z')));

    // Act
    const { events, issues } = expand(feed, '2026-03-01', '2026-04-01', { totalBudgetMs: 0 });

    // Assert
    expect(events.map((event) => event.title)).toEqual(['Single']);
    expect(issues).toEqual({ timeout: 0, invalid: 0, truncated: true });
  });
});

describe('expandFeed：坏系列', () => {
  // 自相矛盾的规则：第 1 周不可能在六月，ical.js 会在一次 next() 里一直找下去
  const runaway = vevent('UID:r', 'SUMMARY:Runaway', 'DTSTART:20200101T090000Z', 'RRULE:FREQ=DAILY;BYWEEKNO=1;BYMONTH=6');
  const fine = vevent('UID:f', 'SUMMARY:Fine', 'DTSTART:20260310T090000Z', 'RRULE:FREQ=DAILY;COUNT=1');

  it('用满自己预算的系列记为超时，其他系列不受影响；同一份解析结果之后直接跳过', () => {
    // Arrange
    const feed = parseFeed(calendar(runaway, fine));

    // Act
    const first = expand(feed, '2026-03-10', '2026-03-11', { seriesBudgetMs: 30 });
    const second = expand(feed, '2026-03-10', '2026-03-11', { seriesBudgetMs: 30 });

    // Assert
    expect(first.events.map((event) => event.title)).toEqual(['Fine']);
    expect(first.issues).toEqual({ timeout: 1, invalid: 0, truncated: false });
    expect(second.events.map((event) => event.title)).toEqual(['Fine']);
    expect(second.issues).toEqual({ timeout: 0, invalid: 1, truncated: false });
  });

  it('只因总预算不够而超时的系列不记为坏系列，下次照样重试', () => {
    // Arrange
    const feed = parseFeed(calendar(runaway));

    // Act
    const first = expand(feed, '2026-03-10', '2026-03-11', { seriesBudgetMs: 500, totalBudgetMs: 30 });
    const second = expand(feed, '2026-03-10', '2026-03-11', { seriesBudgetMs: 500, totalBudgetMs: 30 });

    // Assert
    expect(first.issues).toEqual({ timeout: 1, invalid: 0, truncated: false });
    expect(second.issues).toEqual({ timeout: 1, invalid: 0, truncated: false });
  });

  it('展开时才发现的坏值（RDATE 乱写）记为无效，不影响其他日程', () => {
    // Arrange
    const broken = vevent('UID:b', 'SUMMARY:Broken', 'DTSTART:20260310T090000Z', 'RDATE:garbage');
    const feed = parseFeed(calendar(broken, fine));

    // Act
    const first = expand(feed, '2026-03-10', '2026-03-11');
    const second = expand(feed, '2026-03-10', '2026-03-11');

    // Assert
    expect(first.events.map((event) => event.title)).toEqual(['Fine']);
    expect(first.issues).toEqual({ timeout: 0, invalid: 1, truncated: false });
    expect(second.issues).toEqual({ timeout: 0, invalid: 1, truncated: false });
  });
});

describe('expandFeed：其他', () => {
  it('每年一次的全天日程（生日）；结果整体冻结', () => {
    // Arrange
    const text = calendar(vevent('UID:bd', 'SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20000315', 'RRULE:FREQ=YEARLY'));

    // Act
    const expansion = expand(text, '2026-03-01', '2026-04-01');

    // Assert
    expect(expansion.events.map(brief)).toEqual(['2026-03-15..2026-03-16 Birthday']);
    expect(expansion.events[0].id).toBe('bd@2026-03-15');
    expect(Object.isFrozen(expansion)).toBe(true);
    expect(Object.isFrozen(expansion.events)).toBe(true);
    expect(Object.isFrozen(expansion.events[0])).toBe(true);
    expect(Object.isFrozen(expansion.issues)).toBe(true);
  });

  it('换算不了的时区记为无效，其余照常', () => {
    // Arrange：手工构造，parseFeed 本身不会给出无效时区
    const wall = { kind: 'wall', year: 2026, month: 3, day: 10, hour: 9, minute: 0, second: 0, zone: 'Not/Zone' } as const;
    const ok = { kind: 'instant', ms: Date.UTC(2026, 2, 10, 2) } as const;
    const feed: ParsedFeed = {
      singles: [
        { uid: 'bad', rid: undefined, title: 'Bad', location: undefined, start: wall, end: wall },
        { uid: 'ok', rid: undefined, title: 'Ok', location: '会议室', start: ok, end: ok },
      ],
      series: [],
      skipped: 0,
    };

    // Act
    const { events, issues } = expand(feed, '2026-03-10', '2026-03-11');

    // Assert
    expect(events).toEqual([{ kind: 'timed', id: 'ok@2026-03-10T02:00:00.000Z', title: 'Ok', location: '会议室', start: ok.ms, end: ok.ms }]);
    expect(issues).toEqual({ timeout: 0, invalid: 1, truncated: false });
  });
});
