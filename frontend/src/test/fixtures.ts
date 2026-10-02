import { vi } from 'vitest';
import { DAYS, SLOTS_PER_DAY, type Day, type Meta, type Profile, type Series, type StationSeries } from '../data/types';

export const BASE_URL = 'https://data.example/typical/v1/';

export const META: Meta = {
  generated_at: '2026-10-01T01:30:00Z',
  stations: [
    { id: '1', name: 'PREŠERNOV TRG-PETKOVŠKOVO NABREŽJE', lat: 46.0514, lon: 14.506, capacity: 20 },
    { id: '2', name: 'KONGRESNI TRG-ŠUBIČEVA ULICA', lat: 46.05, lon: 14.503, capacity: 22 },
  ],
};

export function series(value: number | null): Series {
  return Array<number | null>(SLOTS_PER_DAY).fill(value);
}

export function stationSeries(overrides: Partial<StationSeries> = {}): StationSeries {
  return { bikes: series(5), docks: series(15), p_empty: series(0.05), p_full: series(0.02), ...overrides };
}

export function makeProfile(day: Day, overrides: Partial<Profile> = {}): Profile {
  return { profile: day, days_used: 4.2, stations: { '1': stationSeries(), '2': stationSeries() }, ...overrides };
}

/** Route value that makes mockFetch answer HTTP 500. */
export const FAIL = Symbol('fail');
export type Routes = Record<string, unknown>;

export function allRoutes(): Routes {
  const routes: Routes = { 'meta.json': META };
  for (const day of DAYS) routes[`${day}.json`] = makeProfile(day);
  return routes;
}

/** fetch stand-in: serves routes[<last path segment>]; FAIL or a missing route → 500. Mutate `routes` to change answers. */
export function mockFetch(routes: Routes) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const file = String(input).split('/').pop() ?? '';
    const body = routes[file];
    if (body === undefined || body === FAIL) return new Response('error', { status: 500 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function requestedFiles(fn: ReturnType<typeof mockFetch>): string[] {
  return fn.mock.calls.map(([input]) => String(input).split('/').pop() ?? '');
}
