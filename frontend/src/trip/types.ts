import type { LineString } from 'geojson';
import type { Station } from '../data/types';

export interface LngLat {
  lon: number;
  lat: number;
}

export interface Place {
  name: string;
  detail: string;
  at: LngLat;
}

export type Risk = 'safe' | 'risky';
export type TimeMode = 'leave' | 'arrive';

/** What the trip card sets; the day and time come from the availability panel's picker. */
export interface TripChoice {
  from: Place | null;
  to: Place | null;
  timeMode: TimeMode;
  risk: Risk;
}

export interface TripInputs extends TripChoice {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
}

export interface Leg {
  mode: 'walk' | 'bike';
  durationS: number;
  distanceM: number;
  geometry: LineString;
}

export interface StationOdds {
  station: Station;
  chance: number | null;
  acceptable: boolean;
}

export type TripResult =
  | {
      kind: 'bike';
      depart: Date;
      arrive: Date;
      legs: [Leg, Leg, Leg];
      pickup: StationOdds;
      dropoff: StationOdds;
      /** A profile read for pickup or drop-off has days_used < LIMITED_DATA_DAYS. */
      limitedData: boolean;
    }
  | { kind: 'walk'; depart: Date; arrive: Date; legs: [Leg] }
  | { kind: 'no-station'; end: 'start' | 'end' };
