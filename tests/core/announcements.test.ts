import { describe, expect, it } from 'vitest';
import { AnnouncementInput, parseAnnouncements, withAnnouncement } from '../../src/core/announcements';
import { ANNOUNCEMENT_LIMITS, hasUnread, latestAt, type Announcement } from '../../src/lib/announcements';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, extra: Partial<Announcement> = {}): Announcement => ({
  id: id(n),
  title: `第 ${n} 条`,
  body: '',
  createdAt: n * 1000,
  author: '管理员',
  ...extra,
});

describe('AnnouncementInput', () => {
  it('trims both fields and normalizes line breaks, keeping blank lines inside the body', () => {
    expect(AnnouncementInput.parse({ title: '  停机维护  ', body: '\r\n第一行\r\n\r\n第三行\r ' })).toEqual({
      title: '停机维护',
      body: '第一行\n\n第三行',
    });
  });

  it('needs a title, allows an empty body and enforces both limits', () => {
    expect(AnnouncementInput.safeParse({ title: '   ', body: '' }).error?.issues[0]?.message).toBe('请填写标题');
    expect(AnnouncementInput.safeParse({ body: 'x' }).success).toBe(false);
    expect(AnnouncementInput.safeParse({ title: 'x', body: '' }).success).toBe(true);
    expect(AnnouncementInput.safeParse({ title: 'x'.repeat(ANNOUNCEMENT_LIMITS.title + 1), body: '' }).success).toBe(false);
    expect(AnnouncementInput.safeParse({ title: 'x', body: 'x'.repeat(ANNOUNCEMENT_LIMITS.body + 1) }).success).toBe(false);
  });
});

describe('parseAnnouncements', () => {
  it('skips entries it cannot read and sorts the rest newest first', () => {
    const raw = [item(1), { ...item(2), id: '../etc/passwd' }, 'nope', { ...item(3), createdAt: -1 }, item(4), null];
    expect(parseAnnouncements(raw).map((a) => a.id)).toEqual([id(4), id(1)]);
  });

  it('reads anything that is not a list as no announcements, and keeps at most the limit', () => {
    expect(parseAnnouncements({ a: item(1) })).toEqual([]);
    const many = Array.from({ length: ANNOUNCEMENT_LIMITS.count + 5 }, (_, n) => item(n + 1));
    const parsed = parseAnnouncements(many);
    expect(parsed).toHaveLength(ANNOUNCEMENT_LIMITS.count);
    expect(parsed[0]!.id).toBe(id(ANNOUNCEMENT_LIMITS.count + 5));
  });
});

describe('withAnnouncement', () => {
  it('puts the new one first and pushes the oldest out at the limit', () => {
    const full = Array.from({ length: ANNOUNCEMENT_LIMITS.count }, (_, n) => item(ANNOUNCEMENT_LIMITS.count - n));
    const next = withAnnouncement(full, item(999));
    expect(next).toHaveLength(ANNOUNCEMENT_LIMITS.count);
    expect(next[0]!.id).toBe(id(999));
    expect(next.some((a) => a.id === id(1))).toBe(false);
  });
});

describe('unread', () => {
  it('compares the newest announcement with what this browser has seen', () => {
    const list = [item(5), item(2)];
    expect(latestAt(list)).toBe(5000);
    expect(latestAt([])).toBe(0);
    expect(hasUnread(list, 0)).toBe(true);
    expect(hasUnread(list, 4999)).toBe(true);
    expect(hasUnread(list, 5000)).toBe(false);
    expect(hasUnread([], 0)).toBe(false);
  });
});
