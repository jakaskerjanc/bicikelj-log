import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIMITED_DATA_DAYS } from '../controls/TypicalPanel';
import { DAYS, type Meta, type Station } from '../data/types';
import { RouteError, fetchLeg } from './directions';
import { THRESHOLD, selectStations, stationChance, timeline, type Profiles, type SelectQuery } from './plan';
import { ljubljanaInstant, profileSlot } from './time';
import type { LngLat, StationOdds, TripInputs, TripResult } from './types';

export type TripState =
  | { status: 'idle' } // from or to missing, or no valid time
  | { status: 'loading' } // debouncing, waiting for profiles, or fetching legs
  | { status: 'error'; retry: () => void } // a Directions leg failed
  | { status: 'ready'; result: TripResult };

/** How long the inputs must stay unchanged before a trip is planned. */
const DEBOUNCE_MS = 300;

const IDLE: TripState = { status: 'idle' };
const LOADING: TripState = { status: 'loading' };

/** The settled answer for one query on one attempt; anything else is stale. */
interface Outcome {
  query: SelectQuery;
  attempt: number;
  state: Extract<TripState, { status: 'error' | 'ready' }>;
}

const point = (lon: number | undefined, lat: number | undefined): LngLat | null =>
  lon === undefined || lat === undefined ? null : { lon, lat };

/** Select stations, fetch the legs and time the trip. Rejects with the signal's reason when aborted. */
async function planTrip(
  token: string,
  q: SelectQuery,
  meta: Meta,
  profiles: Profiles,
  signal: AbortSignal,
): Promise<TripResult> {
  const holidays = new Set(meta.holidays);
  const selection = selectStations(q, meta.stations, profiles, holidays);
  if (selection.kind === 'no-station') return selection;

  if (selection.kind === 'walk') {
    const leg = await fetchLeg(token, 'walk', q.from, q.to, signal);
    const duration = Math.round(leg.durationS * 1000);
    const leaving = q.timeMode === 'leave';
    return {
      kind: 'walk',
      depart: leaving ? q.time : new Date(q.time.getTime() - duration),
      arrive: leaving ? new Date(q.time.getTime() + duration) : q.time,
      legs: [leg],
    };
  }

  const { pickup, dropoff } = selection;
  const legs = await Promise.all([
    fetchLeg(token, 'walk', q.from, pickup, signal),
    fetchLeg(token, 'bike', pickup, dropoff, signal),
    fetchLeg(token, 'walk', dropoff, q.to, signal),
  ]);
  const { depart, atPickup, atDropoff, arrive } = timeline(q.time, q.timeMode, {
    walk1: legs[0].durationS,
    ride: legs[1].durationS,
    walk2: legs[2].durationS,
  });

  // Stations stay as selected, but the odds are read at the moments the real durations put us there.
  const odds = (station: Station, role: 'pickup' | 'dropoff', at: Date): StationOdds => {
    const chance = stationChance(profiles, holidays, station.id, role, at);
    return { station, chance, acceptable: chance !== null && chance >= THRESHOLD[q.risk] };
  };
  const isThin = (at: Date) => (profiles[profileSlot(at, holidays).day]?.days_used ?? 0) < LIMITED_DATA_DAYS;

  return {
    kind: 'bike',
    depart,
    arrive,
    legs,
    pickup: odds(pickup, 'pickup', atPickup),
    dropoff: odds(dropoff, 'dropoff', atDropoff),
    limitedData: isThin(atPickup) || isThin(atDropoff),
  };
}

/**
 * Turns the trip inputs into a planned route. Waits for the inputs to settle and for the typical profiles,
 * aborts requests superseded by new inputs, and never reports a result for anything but the current inputs.
 * `meta` and `profiles` must keep their identity between renders unless their content changes (as from useTypical).
 */
export function useTrip(
  token: string,
  inputs: TripInputs,
  meta: Meta | null,
  profiles: Profiles,
): TripState {
  const { timeMode, risk } = inputs;
  const fromLon = inputs.from?.at.lon;
  const fromLat = inputs.from?.at.lat;
  const toLon = inputs.to?.at.lon;
  const toLat = inputs.to?.at.lat;
  const timeMs = ljubljanaInstant(inputs.date, inputs.time).getTime(); // NaN while the time is cleared or malformed

  // Same object for the same inputs, so effects and Outcomes can tell whether the inputs changed.
  const query = useMemo<SelectQuery | null>(() => {
    const from = point(fromLon, fromLat);
    const to = point(toLon, toLat);
    return from && to && !Number.isNaN(timeMs) ? { from, to, time: new Date(timeMs), timeMode, risk } : null;
  }, [fromLon, fromLat, toLon, toLat, timeMs, timeMode, risk]);

  const [settled, setSettled] = useState<SelectQuery | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (!query) return;
    const timer = setTimeout(() => setSettled(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Runs again on every input change, so the cleanup aborts the old requests at once even while the
  // new inputs are still debouncing. Retrying skips the debounce: the inputs have long since settled.
  useEffect(() => {
    if (!query || query !== settled || !meta || !DAYS.every((d) => profiles[d])) return;
    const controller = new AbortController();
    const finish = (state: Outcome['state']) => {
      if (!controller.signal.aborted) setOutcome({ query, attempt, state });
    };
    planTrip(token, query, meta, profiles, controller.signal).then(
      (result) => finish({ status: 'ready', result }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        // Directions failures are expected; anything else is a bug, which the retry button must not hide.
        if (!(error instanceof RouteError)) console.error(error);
        finish({ status: 'error', retry });
      },
    );
    return () => controller.abort();
  }, [token, query, settled, meta, profiles, attempt, retry]);

  if (!query) return IDLE;
  return outcome?.query === query && outcome.attempt === attempt ? outcome.state : LOADING;
}
