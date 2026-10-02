// Shapes of the published typical/v1 JSON (backend spec, "Output contract") and UI enums.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

export type Mode = 'bikes' | 'docks';

export const SLOTS_PER_DAY = 96;

/** One value per 15-minute local slot; null = no data. */
export type Series = (number | null)[];

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
}

export interface Meta {
  generated_at: string;
  stations: Station[];
}

export interface StationSeries {
  bikes: Series;
  docks: Series;
  p_empty: Series;
  p_full: Series;
}

export interface Profile {
  profile: Day;
  days_used: number;
  stations: Record<string, StationSeries>;
}
