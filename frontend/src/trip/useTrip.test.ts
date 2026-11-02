import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAYS, type Day, type Meta, type Profile } from '../data/types';
import { FAIL, META, makeProfile, mockFetch, series, stationSeries, type Routes } from '../test/fixtures';
import { clearLegCache } from './directions';
import { ljubljanaInstant } from './time';
import type { Place, TripInputs, TripResult } from './types';
import { useTrip, type TripState } from './useTrip';

const TOKEN = 'pk.test-token';
const MONDAY = '2026-11-02';
const DEBOUNCE_MS = 300;

// Bike tests ride from station 1 to station 2 (279 m apart): only there does a bike beat walking.
const [STATION_1, STATION_2] = META.stations;
const place = (name: string, s: { lon: number; lat: number }): Place => ({
  name,
  detail: '',
  at: { lon: s.lon, lat: s.lat },
});
const P1 = place('Station 1', STATION_1);
const P2 = place('Station 2', STATION_2);
// A second ride, 8 m off each station, so its legs never coincide with (or share cache entries with) P1 -> P2's.
const FROM_B = place('Near station 2', { lon: STATION_2.lon + 0.0001, lat: STATION_2.lat });
const TO_B = place('Near station 1', { lon: STATION_1.lon + 0.0001, lat: STATION_1.lat });

const at = (time: string, date = MONDAY) => ljubljanaInstant(date, time);
const plusSeconds = (t: Date, s: number) => new Date(t.getTime() + s * 1000);
/** Walk 300 s + unlock 60 s + ride 600 s + dock 60 s + walk 300 s. */
const TOTAL_S = 1320;

function inputs(over: Partial<TripInputs> = {}): TripInputs {
  return { from: P1, to: P2, timeMode: 'leave', date: MONDAY, time: '05:00', risk: 'safe', ...over };
}

function profiles(over: Partial<Record<Day, Profile>> = {}): Partial<Record<Day, Profile>> {
  return Object.fromEntries(DAYS.map((d) => [d, over[d] ?? makeProfile(d)]));
}

const route = (duration: number) => ({
  routes: [
    {
      duration,
      distance: duration * 1.4,
      geometry: { type: 'LineString', coordinates: [[14.5, 46.05], [14.51, 46.06]] },
    },
  ],
});
const routes = (): Routes => ({ 'directions/walking': route(300), 'directions/cycling': route(600) });

interface Props {
  inputs: TripInputs;
  meta: Meta | null;
  profiles: Partial<Record<Day, Profile>>;
}
const props = (over: Partial<Props> = {}): Props => ({ inputs: inputs(), meta: META, profiles: profiles(), ...over });

function render(initial: Props, wrapper?: typeof StrictMode) {
  return renderHook((p: Props) => useTrip(TOKEN, p.inputs, p.meta, p.profiles), { initialProps: initial, wrapper });
}

/** Let the debounce elapse. Time also advances on its own (shouldAdvanceTime), so waitFor keeps working. */
const elapse = (ms = DEBOUNCE_MS) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function resultOf(state: TripState): TripResult {
  if (state.status !== 'ready') throw new Error(`expected ready, got ${state.status}`);
  return state.result;
}

function bikeOf(state: TripState) {
  const result = resultOf(state);
  if (result.kind !== 'bike') throw new Error(`expected a bike result, got ${result.kind}`);
  return result;
}

/** Skip the debounce, then wait for a planned trip. */
async function ready(result: { current: TripState }) {
  await elapse();
  await waitFor(() => expect(result.current.status).toBe('ready'));
}

interface HeldRequest {
  url: string;
  respond: (body: unknown) => void;
}

/** A fetch whose answers are held until the test releases them, to control the order of responses. */
function heldFetch() {
  const held: HeldRequest[] = [];
  const fn = vi.fn(
    (input: RequestInfo | URL) =>
      new Promise<Response>((resolve) => {
        held.push({
          url: String(input),
          respond: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })),
        });
      }),
  );
  vi.stubGlobal('fetch', fn);
  return { fn, held };
}

function release(batch: HeldRequest[], walk: number, ride: number) {
  for (const { url, respond } of batch) respond(route(url.includes('/cycling/') ? ride : walk));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearLegCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTrip', () => {
  it('is idle without a destination, and never fetches', async () => {
    const fetchFn = mockFetch(routes());
    const { result } = render(props({ inputs: inputs({ to: null }) }));
    await elapse(1000);
    expect(result.current).toEqual({ status: 'idle' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is idle without a start', async () => {
    mockFetch(routes());
    const { result } = render(props({ inputs: inputs({ from: null }) }));
    await elapse(1000);
    expect(result.current).toEqual({ status: 'idle' });
  });

  it('is idle while the time is cleared, then plans once it is valid again', async () => {
    const fetchFn = mockFetch(routes());
    const { result, rerender } = render(props({ inputs: inputs({ time: '' }) }));
    await elapse(1000);
    expect(result.current).toEqual({ status: 'idle' });
    expect(fetchFn).not.toHaveBeenCalled();

    rerender(props({ inputs: inputs({ time: '05:00' }) }));
    await ready(result);
    expect(bikeOf(result.current).depart).toEqual(at('05:00'));
  });

  it('plans a Leave at bike trip from the real Directions durations', async () => {
    mockFetch(routes());
    const { result } = render(props());
    await ready(result);
    const trip = bikeOf(result.current);
    expect(trip.depart).toEqual(at('05:00'));
    expect(trip.arrive).toEqual(plusSeconds(at('05:00'), TOTAL_S));
    expect(trip.legs.map((l) => l.mode)).toEqual(['walk', 'bike', 'walk']);
    expect(trip.legs.map((l) => l.durationS)).toEqual([300, 600, 300]);
    expect(trip.pickup.station.id).toBe('1');
    expect(trip.dropoff.station.id).toBe('2');
    expect(trip.pickup.chance).toBeCloseTo(0.95);
    expect(trip.dropoff.chance).toBeCloseTo(0.98);
    expect(trip.pickup.acceptable).toBe(true);
    expect(trip.dropoff.acceptable).toBe(true);
    expect(trip.limitedData).toBe(false);
  });

  it('plans an Arrive by trip backwards from the arrival time', async () => {
    mockFetch(routes());
    const { result } = render(props({ inputs: inputs({ timeMode: 'arrive', time: '05:30' }) }));
    await ready(result);
    const trip = bikeOf(result.current);
    expect(trip.arrive).toEqual(at('05:30'));
    expect(trip.depart).toEqual(plusSeconds(at('05:30'), -TOTAL_S));
  });

  it('judges the stations at the moment you really get there, not at the estimate', async () => {
    mockFetch(routes());
    // Leaving at 05:10 the estimates put the pickup in slot 20 (05:00-05:15), but the real 300 s walk
    // arrives in slot 21, where station 1 is usually empty.
    const emptyAt21 = series(0.05);
    emptyAt21[21] = 0.6;
    const mon = makeProfile('mon', { stations: { '1': stationSeries({ p_empty: emptyAt21 }), '2': stationSeries() } });
    const { result } = render(props({ inputs: inputs({ time: '05:10' }), profiles: profiles({ mon }) }));
    await ready(result);
    const trip = bikeOf(result.current);
    expect(trip.pickup.station.id).toBe('1'); // stations are not re-selected
    expect(trip.pickup.chance).toBeCloseTo(0.4);
    expect(trip.pickup.acceptable).toBe(false);
    expect(trip.dropoff.acceptable).toBe(true);
  });

  it('checks acceptability against the risk setting', async () => {
    mockFetch(routes());
    const unlikely = stationSeries({ p_empty: series(0.3) }); // 0.7 chance of a bike
    const mon = makeProfile('mon', { stations: { '1': unlikely, '2': unlikely } });
    const safe = render(props({ inputs: inputs({ risk: 'safe' }), profiles: profiles({ mon }) }));
    await ready(safe.result);
    expect(bikeOf(safe.result.current).pickup.acceptable).toBe(false);

    const risky = render(props({ inputs: inputs({ risk: 'risky' }), profiles: profiles({ mon }) }));
    await ready(risky.result);
    expect(bikeOf(risky.result.current).pickup.acceptable).toBe(true);
  });

  it('plans a walk when walking is faster, with one walking request', async () => {
    const fetchFn = mockFetch(routes());
    const nearby = place('Next door', { lon: STATION_1.lon + 0.0001, lat: STATION_1.lat });
    const { result } = render(props({ inputs: inputs({ to: nearby }) }));
    await ready(result);
    expect(resultOf(result.current)).toMatchObject({
      kind: 'walk',
      depart: at('05:00'),
      arrive: plusSeconds(at('05:00'), 300),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain('/walking/');
  });

  it('plans an Arrive by walk backwards from the arrival time', async () => {
    mockFetch(routes());
    const nearby = place('Next door', { lon: STATION_1.lon + 0.0001, lat: STATION_1.lat });
    const { result } = render(props({ inputs: inputs({ to: nearby, timeMode: 'arrive', time: '05:30' }) }));
    await ready(result);
    expect(resultOf(result.current)).toMatchObject({
      kind: 'walk',
      depart: plusSeconds(at('05:30'), -300),
      arrive: at('05:30'),
    });
  });

  it('reports no station near the start without fetching anything', async () => {
    const fetchFn = mockFetch(routes());
    const faraway = place('Faraway', { lon: 14.6, lat: 46.2 });
    const { result } = render(props({ inputs: inputs({ from: faraway }) }));
    await ready(result);
    expect(resultOf(result.current)).toEqual({ kind: 'no-station', end: 'start' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is loading until the debounce has elapsed, then fetches once for the latest inputs', async () => {
    const fetchFn = mockFetch(routes());
    const { result, rerender } = render(props());
    await elapse(100);
    // A second change 100 ms later, to a trip with different legs so a fetch for the first would show.
    rerender(props({ inputs: inputs({ from: FROM_B, to: TO_B, time: '06:00' }) }));
    await elapse(200);
    expect(result.current).toEqual({ status: 'loading' });
    expect(fetchFn).not.toHaveBeenCalled();

    await elapse(150);
    await ready(result);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(bikeOf(result.current).depart).toEqual(at('06:00'));
    expect(bikeOf(result.current).pickup.station.id).toBe('2');
  });

  it('is loading, with no requests, until meta and all seven profiles are present', async () => {
    const fetchFn = mockFetch(routes());
    const { result, rerender } = render(props({ meta: null, profiles: {} }));
    await elapse(1000);
    expect(result.current).toEqual({ status: 'loading' });

    const { tue: _tue, ...sixDays } = profiles();
    rerender(props({ profiles: sixDays }));
    await elapse(1000);
    expect(result.current).toEqual({ status: 'loading' });
    expect(fetchFn).not.toHaveBeenCalled();

    rerender(props());
    await ready(result);
  });

  it('shows loading, not the previous trip, as soon as the inputs change', async () => {
    mockFetch(routes());
    const { result, rerender } = render(props());
    await ready(result);
    rerender(props({ inputs: inputs({ time: '06:00' }) }));
    expect(result.current).toEqual({ status: 'loading' });
    await ready(result);
    expect(bikeOf(result.current).depart).toEqual(at('06:00'));
  });

  it('never shows a response for superseded inputs, whatever order the responses arrive in', async () => {
    const { held } = heldFetch();
    const { result, rerender } = render(props());
    await elapse();
    expect(held).toHaveLength(3); // trip A is in flight

    rerender(props({ inputs: inputs({ from: FROM_B, to: TO_B, time: '06:00' }) }));
    await elapse();
    expect(held).toHaveLength(6); // trip B is in flight too

    release(held.slice(3), 400, 800); // B answers first...
    await ready(result);
    release(held.slice(0, 3), 300, 600); // ...then A's late answers arrive
    await elapse(50);

    const trip = bikeOf(result.current);
    expect(trip.depart).toEqual(at('06:00'));
    expect(trip.arrive).toEqual(plusSeconds(at('06:00'), 400 + 60 + 800 + 60 + 400));
    expect(trip.pickup.station.id).toBe('2');
  });

  it('aborts the requests in flight as soon as the inputs change', async () => {
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    const { held } = heldFetch();
    const { rerender } = render(props());
    await elapse();
    expect(held).toHaveLength(3);
    expect(abort).not.toHaveBeenCalled();

    rerender(props({ inputs: inputs({ time: '06:00' }) })); // still debouncing, yet trip A is dropped
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('reports an error when a leg fails, and retry runs the same inputs again', async () => {
    const answers = routes();
    answers['directions/cycling'] = FAIL;
    const fetchFn = mockFetch(answers);
    const { result } = render(props());
    await elapse();
    await waitFor(() => expect(result.current.status).toBe('error'));

    answers['directions/cycling'] = route(600);
    const state = result.current;
    if (state.status !== 'error') throw new Error('expected an error');
    const callsBefore = fetchFn.mock.calls.length;
    act(() => state.retry());
    expect(result.current).toEqual({ status: 'loading' });
    await ready(result);
    expect(bikeOf(result.current).depart).toEqual(at('05:00'));
    // The failed cycling leg was fetched again; the walking legs that had succeeded were not.
    expect(fetchFn.mock.calls.length - callsBefore).toBe(1);
  });

  describe('limited data', () => {
    const thin = (day: Day) => makeProfile(day, { days_used: 1.2 });

    it('is flagged when the profile read for the trip has less than two days of history', async () => {
      mockFetch(routes());
      const { result } = render(props({ profiles: profiles({ mon: thin('mon') }) }));
      await ready(result);
      expect(bikeOf(result.current).limitedData).toBe(true);
    });

    it('ignores thin profiles of days the trip does not touch', async () => {
      mockFetch(routes());
      const { result } = render(props({ profiles: profiles({ tue: thin('tue'), sun: thin('sun') }) }));
      await ready(result);
      expect(bikeOf(result.current).limitedData).toBe(false);
    });

    it('reads the day of the drop-off too when the trip crosses midnight', async () => {
      // Leave Monday 23:50: pick up at 23:55 (mon), drop off at 00:06 on Tuesday (tue).
      mockFetch(routes());
      const crossing = inputs({ time: '23:50' });
      const tueOnly = render(props({ inputs: crossing, profiles: profiles({ tue: thin('tue') }) }));
      await ready(tueOnly.result);
      expect(bikeOf(tueOnly.result.current).limitedData).toBe(true);

      const wedOnly = render(props({ inputs: crossing, profiles: profiles({ wed: thin('wed') }) }));
      await ready(wedOnly.result);
      expect(bikeOf(wedOnly.result.current).limitedData).toBe(false);
    });

    it('reads the Sunday profile on a public holiday', async () => {
      mockFetch(routes());
      const holiday = { ...META, holidays: [MONDAY] };
      const { result } = render(props({ meta: holiday, profiles: profiles({ sun: thin('sun') }) }));
      await ready(result);
      expect(bikeOf(result.current).limitedData).toBe(true);
    });
  });

  it('plans once under StrictMode, whose double-invoked effects must not leave a second request behind', async () => {
    const fetchFn = mockFetch(routes());
    const { result } = render(props(), StrictMode);
    await ready(result);
    expect(bikeOf(result.current).depart).toEqual(at('05:00'));
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('makes no request when unmounted during the debounce', async () => {
    const fetchFn = mockFetch(routes());
    const { unmount } = render(props());
    await elapse(100);
    unmount();
    await elapse(1000);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
