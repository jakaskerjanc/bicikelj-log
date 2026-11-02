import type { Leg, LngLat } from './types';
import { cachedRequest } from './requestCache';

/** Any failure to fetch or understand a Mapbox Directions answer. Messages never contain the access token. */
export class RouteError extends Error {
  override name = 'RouteError';
}

const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox';
const PROFILES = { walk: 'walking', bike: 'cycling' } as const;

const legs = new Map<string, Promise<Leg>>();

export function clearLegCache(): void {
  legs.clear();
}

/** Roughly one metre: close enough to share a cache entry, and what we actually ask Mapbox for. */
function round5(n: number): number {
  return Number(n.toFixed(5));
}

function coordinates(p: LngLat): string {
  return `${round5(p.lon)},${round5(p.lat)}`;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isPosition(x: unknown): x is number[] {
  return Array.isArray(x) && x.length >= 2 && x.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function parseLeg(body: unknown, mode: Leg['mode']): Leg {
  if (!isObject(body) || !Array.isArray(body.routes)) throw new RouteError('Directions: unexpected shape');
  if (body.routes.length === 0) throw new RouteError('Directions: no route found');
  const route: unknown = body.routes[0];
  if (
    !isObject(route) ||
    typeof route.duration !== 'number' ||
    typeof route.distance !== 'number' ||
    !isObject(route.geometry) ||
    route.geometry.type !== 'LineString' ||
    !Array.isArray(route.geometry.coordinates) ||
    !route.geometry.coordinates.every(isPosition)
  ) {
    throw new RouteError('Directions: unexpected shape');
  }
  return {
    mode,
    durationS: route.duration,
    distanceM: route.distance,
    geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
  };
}

async function requestLeg(url: string, mode: Leg['mode']): Promise<Leg> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new RouteError('Directions: network error', { cause });
  }
  if (!res.ok) throw new RouteError(`Directions: HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw new RouteError('Directions: not JSON', { cause });
  }
  return parseLeg(body, mode);
}

/** Walking or cycling route between two points. Cached per (profile, from, to); see cachedRequest for abort handling. */
export function fetchLeg(
  token: string,
  mode: Leg['mode'],
  from: LngLat,
  to: LngLat,
  signal?: AbortSignal,
): Promise<Leg> {
  const profile = PROFILES[mode];
  const path = `${profile}/${coordinates(from)};${coordinates(to)}`;
  const url = `${DIRECTIONS_URL}/${path}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;
  return cachedRequest(legs, path, () => requestLeg(url, mode), signal);
}
