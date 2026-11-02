import { describe, expect, it } from 'vitest';
import { defaultTripTime, formatClock, formatDateOption, ljubljanaDate, ljubljanaInstant, profileSlot, tripWhen, weekdayOf } from './time';

const iso = (date: string, time: string) => ljubljanaInstant(date, time).toISOString();

describe('ljubljanaInstant', () => {
  it('converts winter wall-clock time (CET, UTC+1)', () => {
    expect(iso('2026-12-01', '05:30')).toBe('2026-12-01T04:30:00.000Z');
  });

  it('converts summer wall-clock time (CEST, UTC+2)', () => {
    expect(iso('2026-07-01', '05:30')).toBe('2026-07-01T03:30:00.000Z');
  });

  it('handles the evening before and the morning after the spring-forward change', () => {
    expect(iso('2026-03-28', '23:30')).toBe('2026-03-28T22:30:00.000Z');
    expect(iso('2026-03-29', '01:59')).toBe('2026-03-29T00:59:00.000Z');
    expect(iso('2026-03-29', '03:00')).toBe('2026-03-29T01:00:00.000Z');
    expect(iso('2026-03-29', '03:30')).toBe('2026-03-29T01:30:00.000Z');
  });

  it('handles the times around the fall-back change', () => {
    expect(iso('2026-10-25', '01:59')).toBe('2026-10-24T23:59:00.000Z');
    expect(iso('2026-10-25', '03:00')).toBe('2026-10-25T02:00:00.000Z');
    expect(iso('2026-10-25', '05:30')).toBe('2026-10-25T04:30:00.000Z');
  });

  it('moves a time inside the spring-forward gap ahead by the gap', () => {
    // 02:30 does not exist on 2026-03-29; 02:30 + 1 h = 03:30 CEST = 01:30Z.
    expect(iso('2026-03-29', '02:30')).toBe('2026-03-29T01:30:00.000Z');
    expect(iso('2026-03-29', '02:00')).toBe('2026-03-29T01:00:00.000Z');
  });

  it('takes the first (CEST) occurrence of a time repeated by the fall-back change', () => {
    // 02:30 happens twice on 2026-10-25: 00:30Z (CEST) and 01:30Z (CET).
    expect(iso('2026-10-25', '02:30')).toBe('2026-10-25T00:30:00.000Z');
    expect(iso('2026-10-25', '02:00')).toBe('2026-10-25T00:00:00.000Z');
  });

  it('round-trips through formatClock and profileSlot', () => {
    const t = ljubljanaInstant('2026-11-04', '17:45');
    expect(formatClock(t)).toBe('5:45 PM');
    expect(profileSlot(t, new Set())).toEqual({ day: 'wed', slot: 71 });
  });

  it('returns an Invalid Date for malformed input', () => {
    expect(Number.isNaN(ljubljanaInstant('', '05:30').getTime())).toBe(true);
    expect(Number.isNaN(ljubljanaInstant('2026-11-04', '').getTime())).toBe(true);
  });
});

describe('profileSlot', () => {
  it('maps an instant to the Ljubljana weekday and 15-minute slot', () => {
    expect(profileSlot(new Date('2026-11-04T04:00:00Z'), new Set())).toEqual({ day: 'wed', slot: 20 });
    expect(profileSlot(new Date('2026-11-04T04:14:59Z'), new Set())).toEqual({ day: 'wed', slot: 20 });
    expect(profileSlot(new Date('2026-11-04T04:15:00Z'), new Set())).toEqual({ day: 'wed', slot: 21 });
  });

  it('uses Sunday for a public holiday', () => {
    const holidays = new Set(['2026-12-25']);
    expect(profileSlot(new Date('2026-12-25T04:30:00Z'), holidays)).toEqual({ day: 'sun', slot: 22 }); // Fri
  });

  it('keeps the real weekday on days that are not holidays', () => {
    const holidays = new Set(['2026-12-25']);
    expect(profileSlot(new Date('2026-12-24T04:30:00Z'), holidays)).toEqual({ day: 'thu', slot: 22 });
  });

  it('takes the holiday from the Ljubljana date, not the UTC date', () => {
    const holidays = new Set(['2026-12-25']);
    // 23:30 UTC on the 24th is 00:30 on the 25th in Ljubljana.
    expect(profileSlot(new Date('2026-12-24T23:30:00Z'), holidays)).toEqual({ day: 'sun', slot: 2 });
    // 23:30 UTC on the 25th is already the 26th in Ljubljana.
    expect(profileSlot(new Date('2026-12-25T23:30:00Z'), holidays)).toEqual({ day: 'sat', slot: 2 });
  });

  it('rolls over to the next Ljubljana day just after midnight', () => {
    expect(profileSlot(new Date('2026-12-24T23:05:00Z'), new Set())).toEqual({ day: 'fri', slot: 0 });
  });

  it('reports the last slot of the day', () => {
    expect(profileSlot(new Date('2026-12-01T22:59:00Z'), new Set())).toEqual({ day: 'tue', slot: 95 });
  });
});

describe('tripWhen', () => {
  // Monday 2 Nov 2026, 11:00 in Ljubljana: slot 44 is 11:00-11:15.
  const MONDAY_11 = new Date('2026-11-02T10:00:00Z');

  it('a later slot today is today at the start of that slot', () => {
    expect(tripWhen('mon', 72, MONDAY_11)).toEqual({ date: '2026-11-02', time: '18:00' });
    expect(tripWhen('mon', 73, MONDAY_11)).toEqual({ date: '2026-11-02', time: '18:15' });
  });

  it('an earlier slot today stays today, so it can be shown as already passed', () => {
    expect(tripWhen('mon', 4, MONDAY_11)).toEqual({ date: '2026-11-02', time: '01:00' });
  });

  it("today's current slot is now, rounded up to the next 5 minutes", () => {
    expect(tripWhen('mon', 44, new Date('2026-11-02T10:02:00Z'))).toEqual({ date: '2026-11-02', time: '11:05' });
    expect(tripWhen('mon', 44, MONDAY_11)).toEqual({ date: '2026-11-02', time: '11:00' });
  });

  it('the current slot rounding past midnight lands on the next date', () => {
    // 23:58 Monday in Ljubljana, the last slot of the day.
    expect(tripWhen('mon', 95, new Date('2026-11-02T22:58:00Z'))).toEqual({ date: '2026-11-03', time: '00:00' });
  });

  it("another day is that weekday's next date, within the coming week", () => {
    expect(tripWhen('tue', 44, MONDAY_11)).toEqual({ date: '2026-11-03', time: '11:00' });
    expect(tripWhen('sun', 0, MONDAY_11)).toEqual({ date: '2026-11-08', time: '00:00' });
    // From Monday 30 Nov, Sunday is six days ahead, across the month end.
    expect(tripWhen('sun', 95, new Date('2026-11-30T10:00:00Z'))).toEqual({ date: '2026-12-06', time: '23:45' });
  });

  it('uses the Ljubljana date, not the UTC one', () => {
    // 00:30 Tuesday in Ljubljana is still Monday in UTC.
    const tuesdayEarly = new Date('2026-11-02T23:30:00Z');
    expect(tripWhen('tue', 40, tuesdayEarly)).toEqual({ date: '2026-11-03', time: '10:00' });
    expect(tripWhen('mon', 40, tuesdayEarly)).toEqual({ date: '2026-11-09', time: '10:00' });
  });

  it('weekdayOf names the day of a date', () => {
    expect(weekdayOf('2026-11-02')).toBe('mon');
    expect(weekdayOf('2027-01-01')).toBe('fri');
  });
});

describe('defaultTripTime', () => {
  it('rounds up to the next 5 minutes', () => {
    expect(defaultTripTime(new Date('2026-11-02T10:02:00Z'))).toEqual({ date: '2026-11-02', time: '11:05' });
    expect(defaultTripTime(new Date('2026-11-02T10:56:30Z'))).toEqual({ date: '2026-11-02', time: '12:00' });
  });

  it('keeps an exact multiple of 5 minutes', () => {
    expect(defaultTripTime(new Date('2026-11-02T04:00:00Z'))).toEqual({ date: '2026-11-02', time: '05:00' });
  });

  it('rounds up a few seconds past a multiple of 5 minutes', () => {
    expect(defaultTripTime(new Date('2026-11-02T04:00:01Z'))).toEqual({ date: '2026-11-02', time: '05:05' });
  });

  it('carries over into the next date', () => {
    expect(defaultTripTime(new Date('2026-11-02T22:58:00Z'))).toEqual({ date: '2026-11-03', time: '00:00' });
  });

  it('carries over month and year ends', () => {
    expect(defaultTripTime(new Date('2026-12-31T22:58:00Z'))).toEqual({ date: '2027-01-01', time: '00:00' });
  });

  it('uses the wall clock after the spring-forward change', () => {
    // 00:58Z is 01:58 CET; five minutes later the clock reads 03:00 CEST.
    expect(defaultTripTime(new Date('2026-03-29T00:58:00Z'))).toEqual({ date: '2026-03-29', time: '03:00' });
  });
});

describe('formatClock', () => {
  it('formats Ljubljana time as h:mm AM/PM', () => {
    expect(formatClock(new Date('2026-11-03T04:04:00Z'))).toBe('5:04 AM');
    expect(formatClock(new Date('2026-11-03T11:59:00Z'))).toBe('12:59 PM');
    expect(formatClock(new Date('2026-11-03T15:30:00Z'))).toBe('4:30 PM');
  });

  it('shows midnight as 12:xx AM and noon as 12:xx PM', () => {
    expect(formatClock(new Date('2026-11-02T23:00:00Z'))).toBe('12:00 AM');
    expect(formatClock(new Date('2026-11-03T11:00:00Z'))).toBe('12:00 PM');
  });

  it('uses summer time in summer', () => {
    expect(formatClock(new Date('2026-07-01T03:30:00Z'))).toBe('5:30 AM');
  });
});

describe('formatDateOption', () => {
  it('labels today and tomorrow', () => {
    expect(formatDateOption('2026-11-02', '2026-11-02')).toBe('Today');
    expect(formatDateOption('2026-11-03', '2026-11-02')).toBe('Tomorrow');
  });

  it('formats other dates as weekday, day and month', () => {
    expect(formatDateOption('2026-11-04', '2026-11-02')).toBe('Wed 4 Nov');
    expect(formatDateOption('2026-11-09', '2026-11-02')).toBe('Mon 9 Nov');
  });

  it('treats tomorrow as the next calendar date across month and year ends', () => {
    expect(formatDateOption('2026-12-01', '2026-11-30')).toBe('Tomorrow');
    expect(formatDateOption('2027-01-01', '2026-12-31')).toBe('Tomorrow');
  });

  it('treats tomorrow as the next calendar date on a 25 hour day', () => {
    expect(formatDateOption('2026-10-26', '2026-10-25')).toBe('Tomorrow');
    expect(formatDateOption('2026-10-25', '2026-10-24')).toBe('Tomorrow');
  });
});

describe('ljubljanaDate', () => {
  it('is the Ljubljana calendar date, whatever the device timezone', () => {
    expect(ljubljanaDate(new Date('2026-11-02T22:59:59Z'))).toBe('2026-11-02');
    expect(ljubljanaDate(new Date('2026-11-02T23:00:00Z'))).toBe('2026-11-03'); // midnight in Ljubljana (UTC+1)
    expect(ljubljanaDate(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02'); // midnight in summer (UTC+2)
  });
});
