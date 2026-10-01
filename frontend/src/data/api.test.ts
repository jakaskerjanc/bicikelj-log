import { describe, expect, it } from 'vitest';
import { BASE_URL, META, makeProfile, mockFetch, series, stationSeries } from '../test/fixtures';
import type { StationSeries } from './types';
import { DataError, fetchMeta, fetchProfile, parseMeta, parseProfile } from './api';

describe('parseMeta', () => {
  it('accepts a valid document and ignores extra fields', () => {
    expect(parseMeta({ ...META, timezone: 'Europe/Ljubljana', slot_minutes: 15 })).toEqual(META);
  });

  it('rejects a station without coordinates', () => {
    const bad = { ...META, stations: [{ id: '1', name: 'X', capacity: 20 }] };
    expect(() => parseMeta(bad)).toThrow(DataError);
  });
});

describe('parseProfile', () => {
  it('accepts a valid document', () => {
    const doc = makeProfile('mon');
    expect(parseProfile(doc, 'mon')).toEqual(doc);
  });

  it('rejects an array that is not 96 long', () => {
    const doc = makeProfile('mon', { stations: { '1': stationSeries({ bikes: series(5).slice(0, 95) }) } });
    expect(() => parseProfile(doc, 'mon')).toThrow(DataError);
  });

  it('rejects a station missing a field', () => {
    const partial: Partial<StationSeries> = stationSeries();
    delete partial.p_full;
    const doc = { profile: 'mon', days_used: 1, stations: { '1': partial } };
    expect(() => parseProfile(doc, 'mon')).toThrow(DataError);
  });

  it('rejects a document for a different day', () => {
    expect(() => parseProfile(makeProfile('tue'), 'mon')).toThrow(DataError);
  });
});

describe('fetchMeta / fetchProfile', () => {
  it('request <base>meta.json and <base><day>.json', async () => {
    const fetchFn = mockFetch({ 'meta.json': META, 'wed.json': makeProfile('wed') });
    await fetchMeta(BASE_URL);
    await fetchProfile(BASE_URL, 'wed');
    expect(fetchFn.mock.calls.map(([u]) => String(u))).toEqual([`${BASE_URL}meta.json`, `${BASE_URL}wed.json`]);
  });

  it('base URL without trailing slash', async () => {
    const fetchFn = mockFetch({ 'meta.json': META });
    await fetchMeta('https://data.example/typical/v1');
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://data.example/typical/v1/meta.json');
  });

  it('turn HTTP errors into DataError', async () => {
    mockFetch({});
    await expect(fetchMeta(BASE_URL)).rejects.toThrow(DataError);
  });

  it('turn non-JSON bodies into DataError', async () => {
    const fetchFn = mockFetch({});
    fetchFn.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(fetchMeta(BASE_URL)).rejects.toThrow(DataError);
  });
});
