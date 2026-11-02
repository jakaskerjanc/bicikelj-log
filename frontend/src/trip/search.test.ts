import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FAIL, META, mockFetch, type Routes } from '../test/fixtures';
import { LJUBLJANA_BBOX, LJUBLJANA_CENTER } from './boundary';
import { SearchError, clearSearchCache, matchStations, searchPlaces } from './search';

const TOKEN = 'pk.test-token';

interface FeatureOpts {
  name: string;
  at: [number, number];
  place?: string;
  address?: string;
}

function feature({ name, at, place, address }: FeatureOpts) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: at },
    properties: {
      name,
      ...(place !== undefined && { place_formatted: place }),
      ...(address !== undefined && { full_address: address }),
    },
  };
}

const RESPONSE = {
  type: 'FeatureCollection',
  features: [
    feature({ name: 'Prešernov trg', at: [14.5058, 46.0514], place: 'Ljubljana, Slovenija', address: 'ignored' }),
    feature({ name: 'Tromostovje', at: [14.5063, 46.0505], address: 'Tromostovje, Ljubljana' }),
    feature({ name: 'Glavni trg', at: [14.5, 46.05] }),
  ],
};

beforeEach(() => clearSearchCache());

function deferredFetch() {
  let respond!: (body: unknown) => void;
  const pending = new Promise<Response>((resolve) => {
    respond = (body) => resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  const fn = vi.fn(() => pending);
  vi.stubGlobal('fetch', fn);
  return { fn, respond };
}

describe('searchPlaces', () => {
  it('calls only the free Search Box /forward endpoint with the Ljubljana-biased params', async () => {
    const fetchFn = mockFetch({ 'searchbox/forward': RESPONSE });
    await searchPlaces(TOKEN, 'prešernov', LJUBLJANA_CENTER);

    const url = String(fetchFn.mock.calls[0][0]);
    expect(url).toContain('https://api.mapbox.com/search/searchbox/v1/forward?');
    const params = new URL(url).searchParams;
    expect(params.get('q')).toBe('prešernov');
    expect(params.get('auto_complete')).toBe('true');
    expect(params.get('country')).toBe('si');
    expect(params.get('limit')).toBe('5');
    expect(params.get('language')).toBe('sl');
    expect(params.get('bbox')).toBe(LJUBLJANA_BBOX.join(','));
    expect(params.get('proximity')).toBe('14.5058,46.0569');
    expect(params.get('access_token')).toBe(TOKEN);
    expect(url).not.toContain('suggest');
    expect(url).not.toContain('retrieve');
    expect(url).not.toContain('session_token');
  });

  it('URL-encodes the query', async () => {
    const fetchFn = mockFetch({ 'searchbox/forward': RESPONSE });
    await searchPlaces(TOKEN, 'a&b=c d#e', LJUBLJANA_CENTER);
    const url = String(fetchFn.mock.calls[0][0]);
    expect(url).toContain('q=a%26b%3Dc%20d%23e&');
    expect(new URL(url).searchParams.get('q')).toBe('a&b=c d#e');
  });

  it('maps features to places, preferring place_formatted over full_address for the detail', async () => {
    mockFetch({ 'searchbox/forward': RESPONSE });
    expect(await searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER)).toEqual([
      { name: 'Prešernov trg', detail: 'Ljubljana, Slovenija', at: { lon: 14.5058, lat: 46.0514 } },
      { name: 'Tromostovje', detail: 'Tromostovje, Ljubljana', at: { lon: 14.5063, lat: 46.0505 } },
      { name: 'Glavni trg', detail: '', at: { lon: 14.5, lat: 46.05 } },
    ]);
  });

  it('drops results outside Ljubljana', async () => {
    mockFetch({
      'searchbox/forward': {
        features: [
          feature({ name: 'Glavni trg, Kranj', at: [14.3555, 46.2389], place: 'Kranj' }),
          feature({ name: 'Tromostovje', at: [14.5063, 46.0505], place: 'Ljubljana' }),
        ],
      },
    });
    const places = await searchPlaces(TOKEN, 'glavni trg', LJUBLJANA_CENTER);
    expect(places.map((p) => p.name)).toEqual(['Tromostovje']);
  });

  it('drops features without a name or point coordinates', async () => {
    mockFetch({
      'searchbox/forward': {
        features: [
          { geometry: { coordinates: [14.5, 46.05] }, properties: {} },
          { geometry: { coordinates: [14.5] }, properties: { name: 'Broken' } },
          feature({ name: 'Tromostovje', at: [14.5063, 46.0505] }),
        ],
      },
    });
    const places = await searchPlaces(TOKEN, 'x', LJUBLJANA_CENTER);
    expect(places.map((p) => p.name)).toEqual(['Tromostovje']);
  });

  it('caches per trimmed, lower-cased query', async () => {
    const fetchFn = mockFetch({ 'searchbox/forward': RESPONSE });
    await searchPlaces(TOKEN, 'Trg', LJUBLJANA_CENTER);
    await searchPlaces(TOKEN, '  trg ', LJUBLJANA_CENTER);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await searchPlaces(TOKEN, 'trg 2', LJUBLJANA_CENTER);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not call Mapbox for a blank query', async () => {
    const fetchFn = mockFetch({ 'searchbox/forward': RESPONSE });
    expect(await searchPlaces(TOKEN, '   ', LJUBLJANA_CENTER)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects with SearchError on HTTP errors and fetches again next time', async () => {
    const routes: Routes = { 'searchbox/forward': FAIL };
    const fetchFn = mockFetch(routes);
    await expect(searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER)).rejects.toBeInstanceOf(SearchError);

    routes['searchbox/forward'] = RESPONSE;
    expect(await searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER)).toHaveLength(3);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not leak the access token into error messages', async () => {
    mockFetch({ 'searchbox/forward': FAIL });
    await expect(searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER)).rejects.not.toThrow(TOKEN);
  });

  it('rejects with SearchError when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER)).rejects.toBeInstanceOf(SearchError);
  });

  it('rejects with SearchError when features is missing', async () => {
    mockFetch({ 'searchbox/forward': { suggestions: [] } });
    await expect(searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER)).rejects.toBeInstanceOf(SearchError);
  });

  describe('aborting', () => {
    it('rejects with the AbortError, not a SearchError, when aborted mid-flight', async () => {
      deferredFetch();
      const controller = new AbortController();
      const result = searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER, controller.signal);
      controller.abort();
      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      await expect(result).rejects.not.toBeInstanceOf(SearchError);
    });

    it('rejects with the AbortError without fetching when already aborted', async () => {
      const fetchFn = mockFetch({ 'searchbox/forward': RESPONSE });
      const controller = new AbortController();
      controller.abort();
      await expect(searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('still serves the next call after an aborted one, from the same request', async () => {
      const { fn, respond } = deferredFetch();
      const controller = new AbortController();
      const aborted = searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER, controller.signal);
      controller.abort();
      await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

      const next = searchPlaces(TOKEN, 'trg', LJUBLJANA_CENTER);
      respond(RESPONSE);
      expect(await next).toHaveLength(3);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('matchStations', () => {
  it('matches case- and diacritic-insensitively', () => {
    expect(matchStations('presernov', META.stations)).toEqual([
      { name: 'Prešernov Trg-Petkovškovo Nabrežje', detail: 'BicikeLJ station', at: { lon: 14.506, lat: 46.0514 } },
    ]);
    expect(matchStations('SUBIC', META.stations).map((p) => p.name)).toEqual(['Kongresni Trg-Šubičeva Ulica']);
    expect(matchStations('šubič', META.stations)).toHaveLength(1);
  });

  it('matches anywhere in the name, in station order', () => {
    expect(matchStations('trg', META.stations).map((p) => p.name)).toEqual([
      'Prešernov Trg-Petkovškovo Nabrežje',
      'Kongresni Trg-Šubičeva Ulica',
    ]);
  });

  it('returns nothing when nothing matches or the query is blank', () => {
    expect(matchStations('xyz', META.stations)).toEqual([]);
    expect(matchStations('  ', META.stations)).toEqual([]);
  });

  it('returns at most 5 matches', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      name: `TRG ${i}`,
      lat: 46.05,
      lon: 14.5,
      capacity: 10,
    }));
    expect(matchStations('trg', many).map((p) => p.name)).toEqual(['Trg 0', 'Trg 1', 'Trg 2', 'Trg 3', 'Trg 4']);
  });
});
