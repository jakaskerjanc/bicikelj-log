import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import boundary from './ljubljana-boundary.json';
import { pointInPolygon } from './geo';
import type { LngLat } from './types';

/** OSM relation 1675898 (Mestna občina Ljubljana), simplified by Nominatim. */
export const LJUBLJANA_BOUNDARY = boundary as Feature<Polygon | MultiPolygon>;

export const LJUBLJANA_CENTER: LngLat = { lon: 14.5058, lat: 46.0569 };

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number];

function bboxOf(poly: Polygon | MultiPolygon): BBox {
  const rings: Position[][] = poly.type === 'Polygon' ? poly.coordinates : poly.coordinates.flat();
  const bbox: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      bbox[0] = Math.min(bbox[0], lon);
      bbox[1] = Math.min(bbox[1], lat);
      bbox[2] = Math.max(bbox[2], lon);
      bbox[3] = Math.max(bbox[3], lat);
    }
  }
  return bbox;
}

export const LJUBLJANA_BBOX: BBox = bboxOf(LJUBLJANA_BOUNDARY.geometry);

export function insideLjubljana(p: LngLat): boolean {
  return pointInPolygon(p, LJUBLJANA_BOUNDARY.geometry);
}
