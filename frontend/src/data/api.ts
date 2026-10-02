import { SLOTS_PER_DAY, type Day, type Meta, type Profile, type Series, type Station, type StationSeries } from './types';

/** Any failure to fetch or understand a published document. */
export class DataError extends Error {
  override name = 'DataError';
}

const FIELDS = ['bikes', 'docks', 'p_empty', 'p_full'] as const;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isSeries(x: unknown): x is Series {
  return (
    Array.isArray(x) &&
    x.length === SLOTS_PER_DAY &&
    x.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v)))
  );
}

function isStation(x: unknown): x is Station {
  return (
    isObject(x) &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    typeof x.lat === 'number' &&
    typeof x.lon === 'number' &&
    typeof x.capacity === 'number'
  );
}

export function parseMeta(x: unknown): Meta {
  if (!isObject(x) || typeof x.generated_at !== 'string' || !Array.isArray(x.stations) || !x.stations.every(isStation)) {
    throw new DataError('meta.json: unexpected shape');
  }
  return {
    generated_at: x.generated_at,
    stations: x.stations.map(({ id, name, lat, lon, capacity }) => ({ id, name, lat, lon, capacity })),
  };
}

export function parseProfile(x: unknown, day: Day): Profile {
  const bad = new DataError(`${day}.json: unexpected shape`);
  if (!isObject(x) || x.profile !== day || typeof x.days_used !== 'number' || !isObject(x.stations)) throw bad;
  for (const s of Object.values(x.stations)) {
    if (!isObject(s) || !FIELDS.every((f) => isSeries(s[f]))) throw bad;
  }
  return { profile: day, days_used: x.days_used, stations: x.stations as Record<string, StationSeries> };
}

function fileUrl(baseUrl: string, file: string): string {
  return (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) + file;
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new DataError(`${url}: network error`, { cause });
  }
  if (!res.ok) throw new DataError(`${url}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (cause) {
    throw new DataError(`${url}: not JSON`, { cause });
  }
}

export async function fetchMeta(baseUrl: string): Promise<Meta> {
  return parseMeta(await getJson(fileUrl(baseUrl, 'meta.json')));
}

export async function fetchProfile(baseUrl: string, day: Day): Promise<Profile> {
  return parseProfile(await getJson(fileUrl(baseUrl, `${day}.json`)), day);
}
