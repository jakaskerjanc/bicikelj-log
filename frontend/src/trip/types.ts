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

export interface TripInputs {
  from: Place | null;
  to: Place | null;
  timeMode: TimeMode;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  risk: Risk;
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
