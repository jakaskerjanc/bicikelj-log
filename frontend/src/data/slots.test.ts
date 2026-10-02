import { describe, expect, it } from 'vitest';
import { dayName, groupMeans, nowInLjubljana, slotLabel } from './slots';

describe('nowInLjubljana', () => {
  it('maps 09:05 Ljubljana time to slot 36', () => {
    // 2026-10-05 07:05 UTC = Monday 09:05 CEST
    expect(nowInLjubljana(new Date(Date.UTC(2026, 9, 5, 7, 5)))).toEqual({ day: 'mon', slot: 36 });
  });

  it('uses Ljubljana time, not device or UTC time', () => {
    // 2026-10-04 22:30 UTC is still Sunday in UTC but already Monday 00:30 in Ljubljana
    expect(nowInLjubljana(new Date(Date.UTC(2026, 9, 4, 22, 30)))).toEqual({ day: 'mon', slot: 2 });
  });

  it('handles the spring-forward day', () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST at 01:00 UTC
    expect(nowInLjubljana(new Date(Date.UTC(2026, 2, 29, 0, 30)))).toEqual({ day: 'sun', slot: 6 });
    expect(nowInLjubljana(new Date(Date.UTC(2026, 2, 29, 1, 30)))).toEqual({ day: 'sun', slot: 14 });
  });

  it('handles the fall-back day (02:30 happens twice)', () => {
    expect(nowInLjubljana(new Date(Date.UTC(2026, 9, 25, 0, 30)))).toEqual({ day: 'sun', slot: 10 });
    expect(nowInLjubljana(new Date(Date.UTC(2026, 9, 25, 1, 30)))).toEqual({ day: 'sun', slot: 10 });
  });
});

describe('slotLabel', () => {
  it('formats 24-hour times', () => {
    expect(slotLabel(0)).toBe('12:00 AM');
    expect(slotLabel(36)).toBe('9:00 AM');
    expect(slotLabel(37)).toBe('9:15 AM');
    expect(slotLabel(95)).toBe('11:45 PM');
  });
});

describe('dayName', () => {
  it('returns the English weekday', () => {
    expect(dayName('mon')).toBe('Monday');
    expect(dayName('sun')).toBe('Sunday');
  });
});

describe('groupMeans', () => {
  it('averages each group of 2 slots into 48 half hours', () => {
    const values = Array.from({ length: 96 }, (_, i) => Math.floor(i / 2) / 100);
    const result = groupMeans(values, 2);
    expect(result).toHaveLength(48);
    expect(result[0]).toBeCloseTo(0);
    expect(result[47]).toBeCloseTo(0.47);
  });

  it('averages each group of 4 slots into 24 hours', () => {
    const values = Array.from({ length: 96 }, (_, i) => i);
    const result = groupMeans(values, 4);
    expect(result).toHaveLength(24);
    expect(result[0]).toBeCloseTo(1.5);
  });

  it('ignores nulls and returns null for an all-null group', () => {
    const values: (number | null)[] = Array(96).fill(null);
    values[2] = 0.2; // half hour 1: only one real value
    values[4] = 0.3; // half hour 2
    values[5] = 0.5; // half hour 2
    const result = groupMeans(values, 2);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(0.4);
  });
});
