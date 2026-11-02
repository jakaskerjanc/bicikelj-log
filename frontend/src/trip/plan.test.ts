import { describe, expect, it } from 'vitest';
import type { Day, Profile, Station } from '../data/types';
import { distanceM } from './geo';
import {
  DETOUR,
  DOCK_S,
  THRESHOLD,
  UNLOCK_S,
  WALK_MPS,
  selectStations,
  stationChance,
  timeline,
  type Profiles,
  type SelectQuery,
} from './plan';
import { ljubljanaInstant, profileSlot } from './time';
import type { LngLat } from './types';

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

// Everything sits on one east-west line, so a point is just "metres east of the origin".
const LAT = 46.05;
const M_PER_DEG_LON = (Math.PI / 180) * 6_371_000 * Math.cos((LAT * Math.PI) / 180);
const at = (metresEast: number): LngLat => ({ lat: LAT, lon: 14.5 + metresEast / M_PER_DEG_LON });
const station = (id: string, metresEast: number): Station => ({ id, name: id, ...at(metresEast), capacity: 20 });

/** A probability for every slot (number), for one slot (function of the slot), or no data (null). */
type Odds = number | null | ((slot: number) => number | null);
interface StationOdds {
  pEmpty?: Odds;
  pFull?: Odds;
}

function series(odds: Odds = 0): (number | null)[] {
  return Array.from({ length: 96 }, (_, slot) => (typeof odds === 'function' ? odds(slot) : odds));
}

/** A day profile. Stations not mentioned in `odds` are absent; unspecified odds default to "always fine" (0). */
function profile(day: Day, odds: Record<string, StationOdds>): Profile {
  return {
    profile: day,
    days_used: 20,
    stations: Object.fromEntries(
      Object.entries(odds).map(([id, o]) => [
        id,
        { bikes: series(5), docks: series(5), p_empty: series(o.pEmpty), p_full: series(o.pFull) },
      ]),
    ),
  };
}

function everyDay(odds: Record<string, StationOdds>): Profiles {
  return Object.fromEntries((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((d) => [d, profile(d, odds)]));
}

const MONDAY = '2026-11-02';

function leaveAt(time: string, from: LngLat, to: LngLat, risk: SelectQuery['risk'] = 'safe', date = MONDAY): SelectQuery {
  return { from, to, time: ljubljanaInstant(date, time), timeMode: 'leave', risk };
}

function expectBike(sel: ReturnType<typeof selectStations>) {
  if (sel.kind !== 'bike') throw new Error(`expected a bike selection, got ${JSON.stringify(sel)}`);
  return sel;
}

describe('timeline', () => {
  const legs = { walk1: 300, ride: 600, walk2: 120.5 };
  const total = legs.walk1 + UNLOCK_S + legs.ride + DOCK_S + legs.walk2;

  it('leaving at a time walks, unlocks, rides, docks, walks', () => {
    const time = ljubljanaInstant(MONDAY, '08:00');
    const t = timeline(time, 'leave', legs);
    expect(t.depart.getTime()).toBe(time.getTime());
    expect(t.atPickup.getTime()).toBe(time.getTime() + 300_000);
    expect(t.atDropoff.getTime()).toBe(time.getTime() + (300 + UNLOCK_S + 600) * 1000);
    expect(t.arrive.getTime()).toBe(time.getTime() + total * 1000);
  });

  it('arriving by a time departs earlier by the whole trip and arrives exactly on time', () => {
    const time = ljubljanaInstant(MONDAY, '09:00');
    const t = timeline(time, 'arrive', legs);
    expect(t.arrive.getTime()).toBe(time.getTime());
    expect(t.depart.getTime()).toBe(time.getTime() - total * 1000);
    expect(t.atPickup.getTime()).toBe(t.depart.getTime() + 300_000);
    expect(t.atDropoff.getTime()).toBe(t.arrive.getTime() - (DOCK_S + legs.walk2) * 1000);
  });

  it('arrives exactly on time even when the leg durations are not whole milliseconds', () => {
    const time = ljubljanaInstant(MONDAY, '09:00');
    for (let i = 1; i <= 50; i++) {
      const legs = { walk1: i * 1.1234567, ride: i * 7.7654321, walk2: i * 0.3333333 };
      expect(timeline(time, 'arrive', legs).arrive.getTime()).toBe(time.getTime());
    }
  });
});

describe('stationChance', () => {
  const monday8 = ljubljanaInstant(MONDAY, '08:03'); // slot 32
  const profiles: Profiles = {
    mon: profile('mon', {
      a: { pEmpty: (slot) => (slot === 32 ? 0.25 : 0), pFull: (slot) => (slot === 32 ? 0.4 : 0) },
      b: { pEmpty: null, pFull: 0 },
    }),
  };

  it('is 1 − p_empty for a pickup and 1 − p_full for a drop-off, in the slot of the given moment', () => {
    expect(stationChance(profiles, NO_HOLIDAYS, 'a', 'pickup', monday8)).toBeCloseTo(0.75, 10);
    expect(stationChance(profiles, NO_HOLIDAYS, 'a', 'dropoff', monday8)).toBeCloseTo(0.6, 10);
    expect(stationChance(profiles, NO_HOLIDAYS, 'a', 'pickup', ljubljanaInstant(MONDAY, '07:59'))).toBe(1);
  });

  it('is null when the day profile, the station or the slot value is missing', () => {
    expect(stationChance(profiles, NO_HOLIDAYS, 'a', 'pickup', ljubljanaInstant('2026-11-03', '08:03'))).toBeNull();
    expect(stationChance(profiles, NO_HOLIDAYS, 'zzz', 'pickup', monday8)).toBeNull();
    expect(stationChance(profiles, NO_HOLIDAYS, 'b', 'pickup', monday8)).toBeNull();
    expect(stationChance(profiles, NO_HOLIDAYS, 'b', 'dropoff', monday8)).toBe(1);
  });
});

describe('selectStations', () => {
  it('Safe skips a 70% pickup for a 95% one further away; Risky takes the nearer one', () => {
    const from = at(0);
    const to = at(2100);
    const stations = [station('near', 300), station('far', 600), station('drop', 2000)];
    const profiles = everyDay({ near: { pEmpty: 0.3 }, far: { pEmpty: 0.05 }, drop: {} });

    const safe = expectBike(selectStations(leaveAt('08:00', from, to, 'safe'), stations, profiles, NO_HOLIDAYS));
    expect([safe.pickup.id, safe.dropoff.id]).toEqual(['far', 'drop']);

    const risky = expectBike(selectStations(leaveAt('08:00', from, to, 'risky'), stations, profiles, NO_HOLIDAYS));
    expect([risky.pickup.id, risky.dropoff.id]).toEqual(['near', 'drop']);
    expect(risky.estimate.walk1).toBeCloseTo((distanceM(from, stations[0]) * DETOUR) / WALK_MPS, 6);
    expect(risky.estimate.walk2).toBeCloseTo((distanceM(stations[2], to) * DETOUR) / WALK_MPS, 6);
  });

  it('reads the pickup chance at the slot you reach the station, not the slot you leave in', () => {
    // Leaving 07:59 and walking ~4 min reaches "near" at about 08:03, slot 32; "near" is empty in slot 31 only.
    const from = at(0);
    const to = at(2000);
    const stations = [station('near', 250), station('far', 800), station('drop', 1900)];
    const profiles = everyDay({
      near: { pEmpty: (slot) => (slot === 31 ? 1 : 0) },
      far: {},
      drop: {},
    });

    const query = leaveAt('07:59', from, to, 'safe');
    const sel = expectBike(selectStations(query, stations, profiles, NO_HOLIDAYS));
    expect(sel.pickup.id).toBe('near');
    expect(timeline(query.time, 'leave', sel.estimate).atPickup.getTime() - query.time.getTime()).toBeGreaterThan(
      3 * 60_000,
    );
  });

  it('Arrive by just after midnight reads the previous day for pickup and the next day for drop-off', () => {
    const from = at(0);
    const to = at(2500);
    const stations = [station('p1', 100), station('p2', 400), station('d1', 2400), station('d2', 2100)];
    const profiles: Profiles = {
      // p1 is empty all Monday and d1 is full all Tuesday; both are fine on the other day.
      mon: profile('mon', { p1: { pEmpty: 1 }, p2: {}, d1: {}, d2: {} }),
      tue: profile('tue', { p1: {}, p2: {}, d1: { pFull: 1 }, d2: {} }),
    };
    const query: SelectQuery = {
      from,
      to,
      time: ljubljanaInstant('2026-11-03', '00:10'),
      timeMode: 'arrive',
      risk: 'safe',
    };

    const sel = expectBike(selectStations(query, stations, profiles, NO_HOLIDAYS));
    const t = timeline(query.time, 'arrive', sel.estimate);
    // Precondition of the scenario: you pick the bike up before midnight and drop it off after.
    expect(profileSlot(t.atPickup, NO_HOLIDAYS).day).toBe('mon');
    expect(profileSlot(t.atDropoff, NO_HOLIDAYS).day).toBe('tue');
    expect([sel.pickup.id, sel.dropoff.id]).toEqual(['p2', 'd2']);
  });

  it('a public holiday reads the Sunday profile', () => {
    const from = at(0);
    const to = at(2100);
    const stations = [station('near', 300), station('far', 600), station('drop', 2000)];
    const profiles: Profiles = {
      fri: profile('fri', { near: { pEmpty: 1 }, far: {}, drop: {} }),
      sun: profile('sun', { near: {}, far: {}, drop: {} }),
    };
    const christmas = leaveAt('10:00', from, to, 'safe', '2026-12-25'); // a Friday

    const holiday = expectBike(selectStations(christmas, stations, profiles, new Set(['2026-12-25'])));
    expect(holiday.pickup.id).toBe('near');

    const ordinaryFriday = expectBike(selectStations(christmas, stations, profiles, NO_HOLIDAYS));
    expect(ordinaryFriday.pickup.id).toBe('far');
  });

  it('never picks a station whose slot is null, and reports no station at the start when all pickups are null', () => {
    const from = at(0);
    const to = at(2100);
    const stations = [station('near', 300), station('far', 600), station('drop', 2000)];
    const query = leaveAt('08:00', from, to);

    const oneNull = everyDay({ near: { pEmpty: null }, far: {}, drop: {} });
    expect(expectBike(selectStations(query, stations, oneNull, NO_HOLIDAYS)).pickup.id).toBe('far');

    const allNull = everyDay({ near: { pEmpty: null }, far: { pEmpty: null }, drop: {} });
    expect(selectStations(query, stations, allNull, NO_HOLIDAYS)).toEqual({ kind: 'no-station', end: 'start' });

    expect(selectStations(query, stations, {}, NO_HOLIDAYS)).toEqual({ kind: 'no-station', end: 'start' });
  });

  it('reports no station at the end when pickups have data but every drop-off is null', () => {
    const stations = [station('pick', 300), station('drop', 2000)];
    const profiles = everyDay({ pick: {}, drop: { pFull: null } });
    expect(selectStations(leaveAt('08:00', at(0), at(2100)), stations, profiles, NO_HOLIDAYS)).toEqual({
      kind: 'no-station',
      end: 'end',
    });
  });

  it('with no acceptable pair, takes the likeliest one even though it is slower', () => {
    const from = at(0);
    const to = at(2100);
    const stations = [station('near', 300), station('far', 600), station('drop', 2000)];
    // Pickup chances 0.4 and 0.6, drop-off 0.7: nothing reaches Safe's 0.9, and the further pickup is likelier.
    const profiles = everyDay({ near: { pEmpty: 0.6 }, far: { pEmpty: 0.4 }, drop: { pFull: 0.3 } });
    const query = leaveAt('08:00', from, to, 'safe');

    const sel = expectBike(selectStations(query, stations, profiles, NO_HOLIDAYS));
    expect([sel.pickup.id, sel.dropoff.id]).toEqual(['far', 'drop']);

    const t = timeline(query.time, 'leave', sel.estimate);
    const chance = stationChance(profiles, NO_HOLIDAYS, sel.pickup.id, 'pickup', t.atPickup);
    expect(chance).not.toBeNull();
    expect(chance!).toBeLessThan(THRESHOLD.safe);
  });

  it('breaks a tie on estimated total by the higher combined chance', () => {
    // "first" and "second" are the same spot, so every estimate ties exactly; the likelier one is listed last.
    const stations = [station('first', 300), station('second', 300), station('drop', 2000)];
    const profiles = everyDay({ first: { pEmpty: 0.05 }, second: { pEmpty: 0 }, drop: {} });
    const sel = expectBike(selectStations(leaveAt('08:00', at(0), at(2100)), stations, profiles, NO_HOLIDAYS));
    expect(sel.pickup.id).toBe('second');
  });

  it('reports no station at the end when none is within 1 km of the destination', () => {
    const stations = [station('pick', 300), station('drop', 2000)];
    const profiles = everyDay({ pick: {}, drop: {} });
    // "drop" is 1.5 km from the destination.
    expect(selectStations(leaveAt('08:00', at(0), at(3500)), stations, profiles, NO_HOLIDAYS)).toEqual({
      kind: 'no-station',
      end: 'end',
    });
  });

  it('reports no station at the start when none is within 1 km of the origin', () => {
    const stations = [station('pick', 1500), station('drop', 2000)];
    const profiles = everyDay({ pick: {}, drop: {} });
    expect(selectStations(leaveAt('08:00', at(0), at(2100)), stations, profiles, NO_HOLIDAYS)).toEqual({
      kind: 'no-station',
      end: 'start',
    });
  });

  it('walks when the destination is so close that biking cannot beat it', () => {
    const stations = [station('pick', 20), station('drop', 130)];
    const profiles = everyDay({ pick: {}, drop: {} });
    expect(selectStations(leaveAt('08:00', at(0), at(150)), stations, profiles, NO_HOLIDAYS)).toEqual({ kind: 'walk' });
  });

  it('walks when the only station near both ends would be both pickup and drop-off', () => {
    // 1.5 km apart, so a bike would normally matter; the one station in range of both can't serve as both.
    const stations = [station('only', 750)];
    const profiles = everyDay({ only: {} });
    expect(selectStations(leaveAt('08:00', at(0), at(1500)), stations, profiles, NO_HOLIDAYS)).toEqual({ kind: 'walk' });
  });

  it('bikes when the destination is far enough that riding wins', () => {
    const stations = [station('pick', 20), station('drop', 2980)];
    const profiles = everyDay({ pick: {}, drop: {} });
    const sel = expectBike(selectStations(leaveAt('08:00', at(0), at(3000)), stations, profiles, NO_HOLIDAYS));
    expect([sel.pickup.id, sel.dropoff.id]).toEqual(['pick', 'drop']);
  });
});
