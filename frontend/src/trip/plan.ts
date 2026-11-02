// Station selection for the trip planner: which BicikeLJ station to walk to for a bike and where to
// drop it, judged on typical availability at the moment you actually reach each station. Pure: no network.

import type { Day, Profile, Station } from '../data/types';
import { distanceM } from './geo';
import { profileSlot } from './time';
import type { LngLat, Risk, TimeMode } from './types';

/** Stations further than this (straight-line) from the start or end are not considered. */
export const MAX_WALK_M = 1000;
/** Street distance over straight-line distance. */
export const DETOUR = 1.3;
export const WALK_MPS = 4.8 / 3.6;
export const BIKE_MPS = 15 / 3.6;
export const UNLOCK_S = 60;
export const DOCK_S = 60;
/** With no usable station, a trip whose walking estimate is within this is planned on foot instead. */
export const SHORT_WALK_S = 20 * 60;
/** A pickup or drop-off chance at or above this counts as acceptable. */
export const THRESHOLD: Record<Risk, number> = { safe: 0.9, risky: 0.5 };

export type Profiles = Partial<Record<Day, Profile>>;

export interface LegSeconds {
  walk1: number;
  ride: number;
  walk2: number;
}

export interface Timeline {
  depart: Date;
  atPickup: Date;
  atDropoff: Date;
  arrive: Date;
}

export interface SelectQuery {
  from: LngLat;
  to: LngLat;
  time: Date;
  timeMode: TimeMode;
  risk: Risk;
}

export type Selection =
  | { kind: 'bike'; pickup: Station; dropoff: Station; estimate: LegSeconds }
  | { kind: 'walk' }
  | { kind: 'no-station'; end: 'start' | 'end' };

const totalSeconds = ({ walk1, ride, walk2 }: LegSeconds) => walk1 + UNLOCK_S + ride + DOCK_S + walk2;

const walkSeconds = (a: LngLat, b: LngLat) => (distanceM(a, b) * DETOUR) / WALK_MPS;
const rideSeconds = (a: LngLat, b: LngLat) => (distanceM(a, b) * DETOUR) / BIKE_MPS;

/** No usable station at `end`: walk if that is quick enough, otherwise say so. */
const noStation = (q: SelectQuery, end: 'start' | 'end'): Selection =>
  walkSeconds(q.from, q.to) <= SHORT_WALK_S ? { kind: 'walk' } : { kind: 'no-station', end };

/**
 * When you pick the bike up, drop it off, and arrive. `time` is the departure for 'leave' and the arrival
 * for 'arrive'. Each leg is rounded to whole milliseconds first, so an Arrive-by trip lands exactly on `time`.
 */
export function timeline(time: Date, mode: TimeMode, legs: LegSeconds): Timeline {
  const ms = (seconds: number) => Math.round(seconds * 1000);
  const toPickup = ms(legs.walk1);
  const toDropoff = ms(UNLOCK_S) + ms(legs.ride);
  const toArrival = ms(DOCK_S) + ms(legs.walk2);
  const depart = mode === 'leave' ? time.getTime() : time.getTime() - (toPickup + toDropoff + toArrival);
  const atPickup = depart + toPickup;
  const atDropoff = atPickup + toDropoff;
  return {
    depart: new Date(depart),
    atPickup: new Date(atPickup),
    atDropoff: new Date(atDropoff),
    arrive: new Date(atDropoff + toArrival),
  };
}

/**
 * Chance of finding a bike (pickup, 1 − p_empty) or a free dock (dropoff, 1 − p_full) at station `id` at
 * the moment `at`, from the typical profile of that moment's Ljubljana day. Null when that day's profile,
 * the station or the slot value is missing.
 */
export function stationChance(
  profiles: Profiles,
  holidays: ReadonlySet<string>,
  id: string,
  role: 'pickup' | 'dropoff',
  at: Date,
): number | null {
  const { day, slot } = profileSlot(at, holidays);
  const station = profiles[day]?.stations[id];
  if (!station) return null;
  const p = (role === 'pickup' ? station.p_empty : station.p_full)[slot];
  return p === null || p === undefined ? null : 1 - p;
}

interface Candidate {
  pickup: Station;
  dropoff: Station;
  estimate: LegSeconds;
  total: number;
  pickupChance: number;
  dropoffChance: number;
}

const combinedChance = (c: Candidate) => c.pickupChance * c.dropoffChance;

/** Fastest first; equal totals go to the likelier pair. */
const fasterThenLikelier = (a: Candidate, b: Candidate) =>
  a.total - b.total || combinedChance(b) - combinedChance(a);

/** Likeliest first; equal chances go to the faster pair. */
const likelierThenFaster = (a: Candidate, b: Candidate) =>
  combinedChance(b) - combinedChance(a) || a.total - b.total;

const best = (candidates: Candidate[], compare: (a: Candidate, b: Candidate) => number) =>
  candidates.reduce((winner, c) => (compare(c, winner) < 0 ? c : winner));

/**
 * Pick the pickup and drop-off stations for a trip, or decide that walking is faster, or that there is no
 * usable station near the start or the end.
 */
export function selectStations(
  q: SelectQuery,
  stations: Station[],
  profiles: Profiles,
  holidays: ReadonlySet<string>,
): Selection {
  const pickups = stations.filter((s) => distanceM(q.from, s) <= MAX_WALK_M);
  const dropoffs = stations.filter((s) => distanceM(q.to, s) <= MAX_WALK_M);
  if (pickups.length === 0) return noStation(q, 'start');
  if (dropoffs.length === 0) return noStation(q, 'end');

  const pairs = pickups.flatMap((pickup) =>
    dropoffs.filter((dropoff) => dropoff.id !== pickup.id).map((dropoff) => ({ pickup, dropoff })),
  );
  // The only stations in range are the same ones at both ends, so a bike has nowhere to go.
  if (pairs.length === 0) return { kind: 'walk' };

  let anyPickupData = false;
  const candidates: Candidate[] = [];
  for (const { pickup, dropoff } of pairs) {
    const estimate: LegSeconds = {
      walk1: walkSeconds(q.from, pickup),
      ride: rideSeconds(pickup, dropoff),
      walk2: walkSeconds(dropoff, q.to),
    };
    const { atPickup, atDropoff } = timeline(q.time, q.timeMode, estimate);
    const pickupChance = stationChance(profiles, holidays, pickup.id, 'pickup', atPickup);
    const dropoffChance = stationChance(profiles, holidays, dropoff.id, 'dropoff', atDropoff);
    if (pickupChance !== null) anyPickupData = true;
    if (pickupChance === null || dropoffChance === null) continue;
    candidates.push({ pickup, dropoff, estimate, total: totalSeconds(estimate), pickupChance, dropoffChance });
  }
  if (candidates.length === 0) return noStation(q, anyPickupData ? 'end' : 'start');

  const minimum = THRESHOLD[q.risk];
  const acceptable = candidates.filter((c) => c.pickupChance >= minimum && c.dropoffChance >= minimum);
  const winner =
    acceptable.length > 0 ? best(acceptable, fasterThenLikelier) : best(candidates, likelierThenFaster);

  if (walkSeconds(q.from, q.to) <= winner.total) return { kind: 'walk' };
  return { kind: 'bike', pickup: winner.pickup, dropoff: winner.dropoff, estimate: winner.estimate };
}
