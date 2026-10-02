import type { Mode } from './types';

/** Lower bounds of buckets 1..3 for p (chance empty / full). Bucket 0 is everything below 0.1. */
export const THRESHOLDS = [0.1, 0.3, 0.6] as const;
export const BUCKET_COLORS = ['#1ea362', '#f2c12e', '#f26b3a', '#a3201d'] as const;
export const NO_DATA_COLOR = '#9aa0a6';

export function bucket(p: number | null): number | null {
  if (p === null) return null;
  let i = 0;
  while (i < THRESHOLDS.length && p >= THRESHOLDS[i]) i++;
  return i;
}

export function colorFor(p: number | null): string {
  const b = bucket(p);
  return b === null ? NO_DATA_COLOR : BUCKET_COLORS[b];
}

export function legendLabels(mode: Mode): { low: string; high: string } {
  return { low: 'Available', high: mode === 'bikes' ? 'Empty' : 'Full' };
}
