import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FAIL, mockFetch, type Routes } from '../test/fixtures';
import { RouteError, clearLegCache, fetchLeg } from './directions';

const TOKEN = 'pk.test-token';
const FROM = { lon: 14.5058, lat: 46.0569 };
const TO = { lon: 14.5123, lat: 46.0611 };

const GEOMETRY = {
  type: 'LineString',
  coordinates: [
    [14.5058, 46.0569],
    [14.509, 46.059],
    [14.5123, 46.0611],
  ],
};
const OK = { code: 'Ok', routes: [{ duration: 312.4, distance: 1450.2, geometry: GEOMETRY }], waypoints: [] };

beforeEach(() => clearLegCache());

/** A fetch that stays pending until `respond` is called, to abort requests mid-flight. */
function deferredFetch() {
  let respond!: (body: unknown) => void;
  const pending = new Promise<Response>((resolve) => {
    respond = (body) => resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  const fn = vi.fn(() => pending);
  vi.stubGlobal('fetch', fn);
  return { fn, respond };
}

describe('fetchLeg', () => {
  it('requests the walking profile with lon,lat coordinates', async () => {
    const fetchFn = mockFetch({ 'directions/walking': OK });
    await fetchLeg(TOKEN, 'walk', FROM, TO);
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://api.mapbox.com/directions/v5/mapbox/walking/14.5058,46.0569;14.5123,46.0611' +
        '?geometries=geojson&overview=full&access_token=pk.test-token',
    );
  });

  it('requests the cycling profile for bike legs', async () => {
    const fetchFn = mockFetch({ 'directions/cycling': OK });
    await fetchLeg(TOKEN, 'bike', FROM, TO);
    expect(String(fetchFn.mock.calls[0][0])).toContain('/directions/v5/mapbox/cycling/');
  });

  it('parses duration, distance and geometry into a leg with the requested mode', async () => {
    mockFetch({ 'directions/walking': OK, 'directions/cycling': OK });
    expect(await fetchLeg(TOKEN, 'walk', FROM, TO)).toEqual({
      mode: 'walk',
      durationS: 312.4,
      distanceM: 1450.2,
      geometry: GEOMETRY,
    });
    expect((await fetchLeg(TOKEN, 'bike', FROM, TO)).mode).toBe('bike');
  });

  it('answers a repeated request from the cache', async () => {
    const fetchFn = mockFetch({ 'directions/walking': OK });
    const first = await fetchLeg(TOKEN, 'walk', FROM, TO);
    const second = await fetchLeg(TOKEN, 'walk', FROM, TO);
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchFn = mockFetch({ 'directions/walking': OK });
    await Promise.all([fetchLeg(TOKEN, 'walk', FROM, TO), fetchLeg(TOKEN, 'walk', FROM, TO)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('treats coordinates equal to 5 decimals as the same request', async () => {
    const fetchFn = mockFetch({ 'directions/walking': OK });
    await fetchLeg(TOKEN, 'walk', FROM, TO);
    await fetchLeg(TOKEN, 'walk', { lon: 14.505800004, lat: 46.056899996 }, TO);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not share cache entries between profiles or directions', async () => {
    const fetchFn = mockFetch({ 'directions/walking': OK, 'directions/cycling': OK });
    await fetchLeg(TOKEN, 'walk', FROM, TO);
    await fetchLeg(TOKEN, 'bike', FROM, TO);
    await fetchLeg(TOKEN, 'walk', TO, FROM);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('rejects with RouteError on HTTP errors and fetches again next time', async () => {
    const routes: Routes = { 'directions/walking': FAIL };
    const fetchFn = mockFetch(routes);
    await expect(fetchLeg(TOKEN, 'walk', FROM, TO)).rejects.toBeInstanceOf(RouteError);

    routes['directions/walking'] = OK;
    expect((await fetchLeg(TOKEN, 'walk', FROM, TO)).durationS).toBe(312.4);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not leak the access token into error messages', async () => {
    mockFetch({ 'directions/walking': FAIL });
    await expect(fetchLeg(TOKEN, 'walk', FROM, TO)).rejects.not.toThrow(TOKEN);
  });

  it('rejects with RouteError when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchLeg(TOKEN, 'walk', FROM, TO)).rejects.toBeInstanceOf(RouteError);
  });

  it('rejects with RouteError when there is no route', async () => {
    mockFetch({ 'directions/walking': { code: 'NoRoute', routes: [] } });
    await expect(fetchLeg(TOKEN, 'walk', FROM, TO)).rejects.toBeInstanceOf(RouteError);
  });

  it.each([
    ['routes missing', {}],
    ['duration not a number', { routes: [{ duration: '312', distance: 1450, geometry: GEOMETRY }] }],
    ['distance missing', { routes: [{ duration: 312, geometry: GEOMETRY }] }],
    ['geometry not a LineString', { routes: [{ duration: 312, distance: 1450, geometry: { type: 'Point', coordinates: [14.5, 46.05] } }] }],
    ['geometry positions malformed', { routes: [{ duration: 312, distance: 1450, geometry: { type: 'LineString', coordinates: [[14.5]] } }] }],
  ])('rejects with RouteError on a bad shape: %s', async (_, body) => {
    mockFetch({ 'directions/walking': body });
    await expect(fetchLeg(TOKEN, 'walk', FROM, TO)).rejects.toBeInstanceOf(RouteError);
  });

  it('rejects with RouteError when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
    await expect(fetchLeg(TOKEN, 'walk', FROM, TO)).rejects.toBeInstanceOf(RouteError);
  });

  describe('aborting', () => {
    it('rejects with the AbortError, not a RouteError, when aborted mid-flight', async () => {
      const { fn } = deferredFetch();
      const controller = new AbortController();
      const result = fetchLeg(TOKEN, 'walk', FROM, TO, controller.signal);
      controller.abort();
      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      await expect(result).rejects.not.toBeInstanceOf(RouteError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('rejects with the AbortError without fetching when already aborted', async () => {
      const fetchFn = mockFetch({ 'directions/walking': OK });
      const controller = new AbortController();
      controller.abort();
      await expect(fetchLeg(TOKEN, 'walk', FROM, TO, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('still serves the next call after an aborted one, from the same request', async () => {
      const { fn, respond } = deferredFetch();
      const controller = new AbortController();
      const aborted = fetchLeg(TOKEN, 'walk', FROM, TO, controller.signal);
      controller.abort();
      await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

      const next = fetchLeg(TOKEN, 'walk', FROM, TO);
      respond(OK);
      expect((await next).durationS).toBe(312.4);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not abort other callers sharing the request', async () => {
      const { respond } = deferredFetch();
      const controller = new AbortController();
      const aborted = fetchLeg(TOKEN, 'walk', FROM, TO, controller.signal);
      const other = fetchLeg(TOKEN, 'walk', FROM, TO);
      controller.abort();
      respond(OK);
      await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
      expect((await other).distanceM).toBe(1450.2);
    });

    it('serves a cached result to a caller that passes a signal', async () => {
      const fetchFn = mockFetch({ 'directions/walking': OK });
      await fetchLeg(TOKEN, 'walk', FROM, TO);
      const controller = new AbortController();
      const result = fetchLeg(TOKEN, 'walk', FROM, TO, controller.signal);
      await expect(result).resolves.toMatchObject({ mode: 'walk' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });
});
