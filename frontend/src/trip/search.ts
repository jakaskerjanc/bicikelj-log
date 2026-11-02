import { titleCase } from '../data/stations';
import type { Station } from '../data/types';
import { LJUBLJANA_BBOX, insideLjubljana } from './boundary';
import { cachedRequest } from './requestCache';
import type { LngLat, Place } from './types';

/** Any failure to fetch or understand a Mapbox Search Box answer. Messages never contain the access token. */
export class SearchError extends Error {
  override name = 'SearchError';
}

// Free tier only: /forward is one request per query. /suggest and /retrieve are billed per session.
const FORWARD_URL = 'https://api.mapbox.com/search/searchbox/v1/forward';
const MAX_RESULTS = 5;

const searches = new Map<string, Promise<Place[]>>();

export function clearSearchCache(): void {
  searches.clear();
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function text(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined;
}

/** A usable place, or null for a feature with no name or point coordinates. */
function parsePlace(feature: unknown): Place | null {
  if (!isObject(feature) || !isObject(feature.properties) || !isObject(feature.geometry)) return null;
  const name = text(feature.properties.name);
  const coords = feature.geometry.coordinates;
  if (!name || !Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') return null;
  const detail = text(feature.properties.place_formatted) ?? text(feature.properties.full_address) ?? '';
  return { name, detail, at: { lon: coords[0], lat: coords[1] } };
}

async function requestPlaces(url: string): Promise<Place[]> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new SearchError('Search: network error', { cause });
  }
  if (!res.ok) throw new SearchError(`Search: HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw new SearchError('Search: not JSON', { cause });
  }
  if (!isObject(body) || !Array.isArray(body.features)) throw new SearchError('Search: unexpected shape');
  return body.features
    .map(parsePlace)
    .filter((place): place is Place => place !== null && insideLjubljana(place.at));
}

/**
 * Places in Ljubljana matching `query`. Cached per query for the page session (so `proximity` only
 * matters for the first call); see cachedRequest for abort handling. A blank query makes no request.
 */
export async function searchPlaces(
  token: string,
  query: string,
  proximity: LngLat,
  signal?: AbortSignal,
): Promise<Place[]> {
  const q = query.trim();
  if (q === '') return [];
  const params = [
    `q=${encodeURIComponent(q)}`,
    'auto_complete=true',
    'country=si',
    `bbox=${LJUBLJANA_BBOX.join(',')}`,
    `proximity=${proximity.lon},${proximity.lat}`,
    `limit=${MAX_RESULTS}`,
    'language=sl',
    `access_token=${encodeURIComponent(token)}`,
  ];
  const url = `${FORWARD_URL}?${params.join('&')}`;
  return cachedRequest(searches, q.toLowerCase(), () => requestPlaces(url), signal);
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** BicikeLJ stations whose name contains `query`, ignoring case and diacritics. */
export function matchStations(query: string, stations: Station[]): Place[] {
  const needle = normalize(query.trim());
  if (needle === '') return [];
  return stations
    .filter((s) => normalize(s.name).includes(needle))
    .slice(0, MAX_RESULTS)
    .map((s) => ({ name: titleCase(s.name), detail: 'BicikeLJ station', at: { lon: s.lon, lat: s.lat } }));
}
