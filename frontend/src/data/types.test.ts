import { describe, expect, it } from 'vitest';
import { DAYS, SLOTS_PER_DAY } from './types';

describe('types', () => {
  it('days are Monday first and there are 96 slots', () => {
    expect(DAYS).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(SLOTS_PER_DAY).toBe(96);
  });
});
