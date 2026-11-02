import type { MultiPolygon, Polygon, Position } from 'geojson';
import type { LngLat } from './types';

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Ray casting: does a ray from p towards +lon cross the ring an odd number of times? */
function inRing(p: LngLat, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** First ring is the outer boundary, any others are holes. */
function inPolygonRings(p: LngLat, rings: Position[][]): boolean {
  const [outer, ...holes] = rings;
  return inRing(p, outer) && !holes.some((hole) => inRing(p, hole));
}

export function pointInPolygon(p: LngLat, poly: Polygon | MultiPolygon): boolean {
  return poly.type === 'Polygon'
    ? inPolygonRings(p, poly.coordinates)
    : poly.coordinates.some((rings) => inPolygonRings(p, rings));
}
