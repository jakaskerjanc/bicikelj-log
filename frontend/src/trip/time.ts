// Ljubljana wall-clock helpers for the trip planner. Everything here reads and writes Europe/Ljubljana
// time through Intl and pure calendar arithmetic, so results never depend on the device timezone.

import { dayName } from '../data/slots';
import { DAYS, type Day } from '../data/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TRIP_DAY_COUNT = 8;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LJUBLJANA_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Ljubljana',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface WallClock {
  /** Ljubljana calendar date, `YYYY-MM-DD`. */
  date: string;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(t: Date): WallClock {
  const p = Object.fromEntries(LJUBLJANA_CLOCK.formatToParts(t).map((part) => [part.type, part.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

function utcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Calendar arithmetic on `YYYY-MM-DD` strings. UTC has no DST, so every day is exactly 24 h long here. */
function addDays(date: string, days: number): string {
  return new Date(utcMidnight(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(date: string): Day {
  return DAYS[(utcMidnight(date).getUTCDay() + 6) % 7]; // getUTCDay: 0 = Sunday, DAYS starts on Monday
}

/** Ljubljana's UTC offset in ms at a whole-second instant (+1 h in winter, +2 h in summer). */
function offsetMs(instantMs: number): number {
  const { date, hour, minute, second } = wallClock(new Date(instantMs));
  return utcMidnight(date).getTime() + ((hour * 60 + minute) * 60 + second) * 1000 - instantMs;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Ljubljana wall clock (`YYYY-MM-DD`, `HH:mm`) → instant.
 * A time skipped by the spring-forward change moves ahead by the gap; a time repeated by the fall-back
 * change takes its first (summer time) occurrence. Malformed input gives an Invalid Date.
 */
export function ljubljanaInstant(date: string, time: string): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return new Date(NaN);
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  // The offsets a day either side bracket any DST change next to the wall time. An offset is valid when
  // the instant it implies really has that offset: two are valid in the overlap, none in the gap.
  const before = offsetMs(wall - DAY_MS);
  const after = offsetMs(wall + DAY_MS);
  const valid = [before, after].filter((offset) => offsetMs(wall - offset) === offset);
  // The larger offset is the earlier instant (first occurrence). In the gap the offset from before the
  // change applies, which lands the time one gap-length later.
  return new Date(wall - (valid.length > 0 ? Math.max(...valid) : before));
}

/** Profile day and 15-minute slot at `t`; a public holiday (Ljubljana date) uses the Sunday profile. */
export function profileSlot(t: Date, holidays: ReadonlySet<string>): { day: Day; slot: number } {
  const { date, hour, minute } = wallClock(t);
  return {
    day: holidays.has(date) ? 'sun' : weekdayOf(date),
    slot: hour * 4 + Math.floor(minute / 15),
  };
}

/** Today's Ljubljana date and the 7 after it, as consecutive calendar dates. */
export function tripDates(now: Date): string[] {
  const today = wallClock(now).date;
  return Array.from({ length: TRIP_DAY_COUNT }, (_, i) => addDays(today, i));
}

/** Initial trip inputs: the current Ljubljana time rounded up to the next 5 minutes (may land on the next date). */
export function defaultTripTime(now: Date): { date: string; time: string } {
  // Ljubljana's offset is a whole number of hours, so 5-minute boundaries line up with the wall clock.
  const rounded = new Date(Math.ceil(now.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS);
  const { date, hour, minute } = wallClock(rounded);
  return { date, time: `${pad2(hour)}:${pad2(minute)}` };
}

/** Ljubljana time of day as `5:04 AM`. */
export function formatClock(t: Date): string {
  const { hour, minute } = wallClock(t);
  return `${hour % 12 || 12}:${pad2(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** `Today`, `Tomorrow` (the next calendar date), otherwise `Wed 4 Nov`. */
export function formatDateOption(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const [, month, day] = date.split('-').map(Number);
  return `${dayName(weekdayOf(date)).slice(0, 3)} ${day} ${MONTHS[month - 1]}`;
}
