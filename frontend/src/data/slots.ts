import type { Day, Series } from './types';

const DAY_NAMES: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** Slots that get a tick label under the slider and the chart: every 3 hours from 3 AM to 9 PM. */
export const TICK_SLOTS = [12, 24, 36, 48, 60, 72, 84] as const;

const LJUBLJANA_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Ljubljana',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Current weekday and 15-minute slot in Ljubljana, whatever the device timezone. */
export function nowInLjubljana(now: Date = new Date()): { day: Day; slot: number } {
  const parts = Object.fromEntries(LJUBLJANA_CLOCK.formatToParts(now).map((p) => [p.type, p.value]));
  const day = parts.weekday.toLowerCase() as Day; // en-GB short weekday: "Mon" … "Sun"
  return { day, slot: Number(parts.hour) * 4 + Math.floor(Number(parts.minute) / 15) };
}

export function slotLabel(slot: number): string {
  const minutes = slot * 15;
  const hour = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hour % 12 || 12}:${mm} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function dayName(day: Day): string {
  return DAY_NAMES[day];
}

/** 96 quarter-hour values → means of each `size` consecutive slots; nulls are ignored, an all-null group is null. */
export function groupMeans(values: Series, size: number): Series {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, group) => {
    const known = values.slice(group * size, group * size + size).filter((v): v is number => v !== null);
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  });
}
