import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { LJUBLJANA_BBOX, LJUBLJANA_CENTER, insideLjubljana } from './boundary';
import { distanceM, pointInPolygon } from './geo';

const PRESERNOV_TRG = { lon: 14.506, lat: 46.0514 };
const KONGRESNI_TRG = { lon: 14.503, lat: 46.05 };
const TRAIN_STATION = { lon: 14.5103, lat: 46.0583 };

describe('distanceM', () => {
  it('measures Prešernov trg to Kongresni trg at roughly 270 m', () => {
    const d = distanceM(PRESERNOV_TRG, KONGRESNI_TRG);
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThan(300);
  });

  it('is zero for identical points and symmetric', () => {
    expect(distanceM(PRESERNOV_TRG, PRESERNOV_TRG)).toBe(0);
    expect(distanceM(PRESERNOV_TRG, KONGRESNI_TRG)).toBeCloseTo(distanceM(KONGRESNI_TRG, PRESERNOV_TRG), 9);
  });

  it('uses a 6 371 km Earth: one degree of latitude is about 111.19 km', () => {
    expect(distanceM({ lon: 14.5, lat: 46 }, { lon: 14.5, lat: 47 })).toBeCloseTo(111_195, -1);
  });
});

describe('pointInPolygon', () => {
  const squareWithHole: Polygon = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };

  it('is true inside the outer ring and false outside it', () => {
    expect(pointInPolygon({ lon: 2, lat: 2 }, squareWithHole)).toBe(true);
    expect(pointInPolygon({ lon: 12, lat: 5 }, squareWithHole)).toBe(false);
  });

  it('is false inside a hole', () => {
    expect(pointInPolygon({ lon: 5, lat: 5 }, squareWithHole)).toBe(false);
  });

  it('handles each polygon of a MultiPolygon', () => {
    const multi = {
      type: 'MultiPolygon' as const,
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
      ],
    };
    expect(pointInPolygon({ lon: 1, lat: 1 }, multi)).toBe(true);
    expect(pointInPolygon({ lon: 11, lat: 11 }, multi)).toBe(true);
    expect(pointInPolygon({ lon: 6, lat: 6 }, multi)).toBe(false);
  });
});

describe('Ljubljana boundary', () => {
  it('contains the city centre, Prešernov trg and the main train station', () => {
    expect(insideLjubljana(LJUBLJANA_CENTER)).toBe(true);
    expect(insideLjubljana(PRESERNOV_TRG)).toBe(true);
    expect(insideLjubljana(TRAIN_STATION)).toBe(true);
  });

  it('excludes Kranj, Vrhnika and the open sea', () => {
    expect(insideLjubljana({ lon: 14.3556, lat: 46.2389 })).toBe(false);
    expect(insideLjubljana({ lon: 14.2953, lat: 45.9636 })).toBe(false);
    expect(insideLjubljana({ lon: 13.6, lat: 45.5 })).toBe(false);
  });

  it('has a bbox covering the three inside points', () => {
    const [minLon, minLat, maxLon, maxLat] = LJUBLJANA_BBOX;
    for (const p of [LJUBLJANA_CENTER, PRESERNOV_TRG, TRAIN_STATION]) {
      expect(p.lon).toBeGreaterThanOrEqual(minLon);
      expect(p.lon).toBeLessThanOrEqual(maxLon);
      expect(p.lat).toBeGreaterThanOrEqual(minLat);
      expect(p.lat).toBeLessThanOrEqual(maxLat);
    }
  });
});
