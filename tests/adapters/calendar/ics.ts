/** 测试用的 ICS 拼装工具 */

export function calendar(...blocks: readonly (readonly string[])[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...blocks.flat(), 'END:VCALENDAR'].join('\r\n');
}

export function vevent(...lines: readonly string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

export function vtimezone(...lines: readonly string[]): string[] {
  return ['BEGIN:VTIMEZONE', ...lines, 'END:VTIMEZONE'];
}

export function observance(rule: string): string[] {
  return ['BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', rule, 'END:STANDARD'];
}

/** 马德里：三月、十月最后一个星期日切换夏令时 */
export const MADRID: readonly string[] = vtimezone(
  'TZID:Europe/Madrid',
  ...observance('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU'),
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
);
