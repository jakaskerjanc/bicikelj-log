import { describe, expect, it } from 'vitest';
import { BUCKET_COLORS, NO_DATA_COLOR, bucket, colorFor, legendLabels } from './colors';

describe('bucket', () => {
  it.each([
    [0, 0],
    [0.0999, 0],
    [0.1, 1],
    [0.2999, 1],
    [0.3, 2],
    [0.5999, 2],
    [0.6, 3],
    [1, 3],
  ])('p=%s → bucket %s', (p, expected) => {
    expect(bucket(p)).toBe(expected);
  });

  it('null has no bucket', () => {
    expect(bucket(null)).toBeNull();
  });
});

describe('colorFor', () => {
  it('maps buckets to colours and null to grey', () => {
    expect(colorFor(0.05)).toBe(BUCKET_COLORS[0]);
    expect(colorFor(0.7)).toBe(BUCKET_COLORS[3]);
    expect(colorFor(null)).toBe(NO_DATA_COLOR);
  });
});

describe('legendLabels', () => {
  it('says Empty for bikes and Full for docks', () => {
    expect(legendLabels('bikes')).toEqual({ low: 'Available', high: 'Empty' });
    expect(legendLabels('docks')).toEqual({ low: 'Available', high: 'Full' });
  });
});
