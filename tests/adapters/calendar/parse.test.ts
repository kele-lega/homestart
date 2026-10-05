import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { CalendarParseError, impossibleMonthDays, parseFeed } from '../../../src/adapters/calendar/parse';
import { UNTITLED } from '../../../src/adapters/calendar/model';
import { calendar, MADRID, observance, vevent, vtimezone } from './ics';

const utc = (...parts: [number, number, number, number, number?]) =>
  Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4] ?? 0);

describe('parseFeed：单次日程', () => {
  it('UTC、自带 VTIMEZONE、全天、浮动时间各记成对应的 TimeSpec', () => {
    // Arrange：Test/Plus3 不是 IANA 名，只能靠文件里的定义换算
    const plus3 = vtimezone('TZID:Test/Plus3', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'END:STANDARD');
    const text = calendar(
      MADRID,
      plus3,
      vevent('UID:u', 'SUMMARY:UTC', 'DTSTART:20260310T100000Z', 'DTEND:20260310T110000Z'),
      vevent('UID:m', 'SUMMARY:Madrid', 'DTSTART;TZID=Europe/Madrid:20260310T100000', 'DTEND;TZID=Europe/Madrid:20260310T113000'),
      vevent('UID:p', 'SUMMARY:Plus3', 'DTSTART;TZID=Test/Plus3:20260310T100000'),
      vevent('UID:d', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20260310', 'DTEND;VALUE=DATE:20260311'),
      vevent('UID:f', 'SUMMARY:Floating', '  time', 'LOCATION:  Room\t 1 ', 'DTSTART:20260310T100000'),
    );

    // Act
    const feed = parseFeed(text);

    // Assert
    const [u, m, p, d, f] = feed.singles;
    expect(u).toMatchObject({ uid: 'u', rid: undefined, title: 'UTC', start: { kind: 'instant', ms: utc(2026, 3, 10, 10) } });
    expect(u.end).toEqual({ kind: 'instant', ms: utc(2026, 3, 10, 11) });
    expect(m.start).toEqual({ kind: 'instant', ms: utc(2026, 3, 10, 9) });
    expect(m.end).toEqual({ kind: 'instant', ms: utc(2026, 3, 10, 10, 30) });
    expect(p.start).toEqual({ kind: 'instant', ms: utc(2026, 3, 10, 7) });
    expect(d.start).toEqual({ kind: 'date', key: '2026-03-10' });
    expect(d.end).toEqual({ kind: 'date', key: '2026-03-11' });
    const wall = { kind: 'wall', year: 2026, month: 3, day: 10, hour: 10, minute: 0, second: 0, zone: undefined };
    expect(f).toMatchObject({ title: 'Floating time', location: 'Room 1', start: wall, end: wall });
    expect(feed.series).toEqual([]);
    expect(feed.skipped).toBe(0);
  });

  it.each([
    ['Asia/Tokyo', 'Asia/Tokyo'],
    ['/mozilla.org/20050126_1/Europe/Madrid', 'Europe/Madrid'],
    ['China Standard Time', undefined],
    ['Not/A/Zone', undefined],
  ])('没有 VTIMEZONE 的 TZID %s 记成墙上时间，时区解析为 %s', (tzid, zone) => {
    const feed = parseFeed(calendar(vevent('UID:x', `DTSTART;TZID=${tzid}:20260310T100000`)));
    expect(feed.singles[0].start).toMatchObject({ kind: 'wall', hour: 10, zone });
  });
  it('写坏的重复规则只让那条日程退化成单次，不拖垮整份文件', () => {
    // Arrange：ical.js 本身遇到这些规则会让整份 parse 抛错
    const text = calendar(
      vevent('UID:a', 'SUMMARY:Bogus', 'DTSTART:20260310T100000Z', 'RRULE:FREQ=BOGUS'),
      vevent('UID:b', 'SUMMARY:Folded', 'DTSTART:20260311T100000Z', 'rrule:FREQ=DAI', ' LY;BYHOUR=25'),
      vevent('UID:c', 'SUMMARY:Good', 'DTSTART:20260312T100000Z', 'RRULE:FREQ=DAILY;COUNT=2'),
    );

    // Act
    const feed = parseFeed(text);

    // Assert
    expect(feed.singles.map((record) => record.title)).toEqual(['Bogus', 'Folded']);
    expect(feed.series.map((record) => record.uid)).toEqual(['c']);
    expect(feed.skipped).toBe(2);
  });

  it('整份读不懂抛 CalendarParseError，消息不夹带文件内容', () => {
    const secret = 'SUMMARY:私人内容-0123';
    const error = (() => {
      try {
        parseFeed(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n${secret}\r\nEND:VCALENDAR`);
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(CalendarParseError);
    expect((error as CalendarParseError).message).toBe('日历文件格式有误');
    expect(JSON.stringify(error) + String(error)).not.toContain('私人内容');
  });

  it('缺开始时间、时间写坏、年份离谱的日程跳过并计数，已取消的不计', () => {
    const text = calendar(
      vevent('UID:1', 'SUMMARY:No start'),
      vevent('UID:2', 'DTSTART:2026XX10T100000Z'),
      vevent('UID:3', 'DTSTART:00000310T100000Z'),
      vevent('UID:4', 'STATUS:CANCELLED', 'DTSTART:20260310T100000Z'),
      vevent('UID:5', 'SUMMARY:Ok', 'DTSTART:20260310T100000Z'),
    );
    const feed = parseFeed(text);
    expect(feed.singles.map((record) => record.uid)).toEqual(['5']);
    expect(feed.skipped).toBe(3);
  });

  it('超过条数上限的日程计入 skipped；超过时间预算抛超时错误', () => {
    const events = Array.from({ length: 3000 }, (_, i) => vevent(`UID:${i}`, 'DTSTART:20260310T100000Z'));
    const capped = parseFeed(calendar(...events.slice(0, 5)), { maxEvents: 3 });
    expect([capped.singles.length, capped.skipped]).toEqual([3, 2]);
    expect(() => parseFeed(calendar(...events), { budgetMs: 1 })).toThrow('日历文件太复杂，解析超时');
  });
});

describe('parseFeed：VTIMEZONE 消毒', () => {
  const madridEvent = vevent('UID:z', 'DTSTART;TZID=Europe/Madrid:20260310T100000');
  const rdates = Array.from({ length: 1001 }, (_, i) => `RDATE:${1971 + (i % 50)}0101T000000`);

  it.each([
    ['缺 TZID', vtimezone(...observance('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU'))],
    ['不认识的规则部件', vtimezone('TZID:Europe/Madrid', ...observance('RRULE:FREQ=YEARLY;BYMONTH=10;BYSETPOS=1'))],
    ['不是每年一次', vtimezone('TZID:Europe/Madrid', ...observance('RRULE:FREQ=DAILY'))],
    ['星期写法异常', vtimezone('TZID:Europe/Madrid', ...observance('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=9SU'))],
    ['日期不存在', vtimezone('TZID:Europe/Madrid', ...observance('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'))],
    ['未知子组件', vtimezone('TZID:Europe/Madrid', 'BEGIN:X-FOO', 'END:X-FOO')],
    ['没有子组件', vtimezone('TZID:Europe/Madrid')],
    ['子组件过多', vtimezone('TZID:Europe/Madrid', ...Array.from({ length: 201 }, () => observance('RDATE:19800101T000000')).flat())],
    ['RDATE 过多', vtimezone('TZID:Europe/Madrid', ...observance(rdates[0]).slice(0, -1), ...rdates.slice(1), 'END:STANDARD')],
  ])('%s的定义被丢弃，时间改按 TZID 名字换算', (_label, zone) => {
    const feed = parseFeed(calendar(zone, madridEvent));
    expect(feed.singles[0].start).toMatchObject({ kind: 'wall', zone: 'Europe/Madrid' });
  });

  it('正常的定义保留，TZID 过长的引用当浮动时间', () => {
    const long = 'X'.repeat(101);
    const feed = parseFeed(calendar(MADRID, madridEvent, vevent('UID:l', `DTSTART;TZID=${long}:20260310T100000`)));
    expect(feed.singles[0].start).toEqual({ kind: 'instant', ms: utc(2026, 3, 10, 9) });
    expect(feed.singles[1].start).toMatchObject({ kind: 'wall', zone: undefined });
  });
});

describe('impossibleMonthDays', () => {
  it.each([
    ['FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', true],
    ['FREQ=YEARLY;BYMONTH=4,6;BYMONTHDAY=31', true],
    ['FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=-30', true],
    ['FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', false],
    ['FREQ=YEARLY;BYMONTH=2,3;BYMONTHDAY=31', false],
    ['FREQ=MONTHLY;BYMONTHDAY=31', false],
    ['FREQ=YEARLY;BYMONTH=2', false],
  ])('%s → %s', (rule, expected) => {
    expect(impossibleMonthDays(ICAL.Recur.fromString(rule))).toBe(expected);
  });
});
describe('parseFeed：重复日程', () => {
  const weekly = (...extra: string[]) =>
    vevent('UID:w', 'SUMMARY:Weekly', 'DTSTART;TZID=Europe/Madrid:20260302T100000', 'DTEND;TZID=Europe/Madrid:20260302T110000', 'RRULE:FREQ=WEEKLY', ...extra);
  const override = (rid: string, ...extra: string[]) =>
    vevent('UID:w', `RECURRENCE-ID;TZID=Europe/Madrid:${rid}`, ...extra);

  it('改过的那一次独立输出、取消的只记下；找不到主日程的例外照样输出', () => {
    // Arrange
    const text = calendar(
      MADRID,
      weekly(),
      override('20260309T100000', 'SUMMARY:Moved', 'DTSTART;TZID=Europe/Madrid:20260309T150000', 'DTEND;TZID=Europe/Madrid:20260309T160000'),
      override('20260316T100000', 'STATUS:CANCELLED', 'DTSTART;TZID=Europe/Madrid:20260316T100000'),
      vevent('UID:o', 'RECURRENCE-ID:20260310T100000Z', 'SUMMARY:Orphan', 'DTSTART:20260310T120000Z'),
    );

    // Act
    const feed = parseFeed(text);

    // Assert
    expect(feed.singles.map((record) => [record.title, record.rid])).toEqual([
      ['Moved', { kind: 'instant', ms: utc(2026, 3, 9, 9) }],
      ['Orphan', { kind: 'instant', ms: utc(2026, 3, 10, 10) }],
    ]);
    const [series] = feed.series;
    expect(series.uid).toBe('w');
    expect(series.overridden).toEqual([
      { kind: 'instant', ms: utc(2026, 3, 9, 9) },
      { kind: 'instant', ms: utc(2026, 3, 16, 9) },
    ]);
    // zone 只在墙上时间里用；有 VTIMEZONE 时开始时间是 instant，这里的名字无害
    expect([...series.items.values()]).toEqual([{ title: 'Weekly', location: undefined, cancelled: false, zone: 'Europe/Madrid' }]);
    expect(series.reachMs).toBe(3_600_000);
  });

  it('THISANDFUTURE 例外关联到主日程，偏移计入 reachMs', () => {
    const later = vevent(
      'UID:w',
      'RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=Europe/Madrid:20260316T100000',
      'SUMMARY:Late',
      'DTSTART;TZID=Europe/Madrid:20260316T110000',
      'DTEND;TZID=Europe/Madrid:20260316T120000',
    );
    const feed = parseFeed(calendar(MADRID, weekly(), later));
    const titles = [...feed.series[0].items.values()].map((item) => item.title);
    expect(titles).toEqual(['Weekly', 'Late']);
    expect(feed.series[0].reachMs).toBe(2 * 3_600_000);
    expect(feed.singles.map((record) => record.title)).toEqual(['Late']);
  });

  it('规则自相矛盾的系列只剩第一次；整个取消的系列直接省略', () => {
    const text = calendar(
      vevent('UID:i', 'SUMMARY:Impossible', 'DTSTART:20260210T100000Z', 'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30'),
      vevent('UID:c', 'STATUS:CANCELLED', 'DTSTART:20260210T100000Z', 'RRULE:FREQ=DAILY'),
    );
    const feed = parseFeed(text);
    expect(feed.singles.map((record) => record.title)).toEqual(['Impossible']);
    expect([feed.series.length, feed.skipped]).toEqual([0, 0]);
  });

  it('同一文件里的多个 VCALENDAR 都读；没有标题的用占位', () => {
    const text = `${calendar(vevent('UID:1', 'DTSTART:20260310T100000Z'))}\r\n${calendar(vevent('UID:2', 'DTSTART:20260311T100000Z'))}`;
    const feed = parseFeed(text);
    expect(feed.singles.map((record) => [record.uid, record.title, record.location])).toEqual([
      ['1', UNTITLED, undefined],
      ['2', UNTITLED, undefined],
    ]);
  });

  it('缓存里的系列只留展开要用的属性和时区，不拖着整份文件', () => {
    // Arrange：一个带提醒、描述和参与人的重复日程，外加一批无关的单次日程
    const noisy = weekly(
      `DESCRIPTION:${'x'.repeat(200)}`,
      'ATTENDEE:mailto:someone@example.com',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'END:VALARM',
    );
    const others = Array.from({ length: 5 }, (_, i) => vevent(`UID:s${i}`, `DTSTART:2026031${i}T100000Z`));

    // Act
    const [series] = parseFeed(calendar(MADRID, noisy, ...others)).series;

    // Assert
    const component = series.event.component;
    expect(component.getAllProperties().map((prop) => prop.name)).toEqual(['uid', 'summary', 'dtstart', 'dtend', 'rrule']);
    expect(component.getAllSubcomponents()).toEqual([]);
    // 上层只剩时区定义：其余日程随整份文件一起被回收
    expect(component.parent.getAllSubcomponents().map((sub) => sub.name)).toEqual(['vtimezone']);
    // 时区照样按订阅自带的 VTIMEZONE 换算
    expect(series.event.startDate.toUnixTime() * 1000).toBe(utc(2026, 3, 2, 9));
  });
});
