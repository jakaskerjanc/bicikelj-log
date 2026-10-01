import type { FeatureCollection, Point } from 'geojson';
import { SLOTS_PER_DAY, type Meta, type Mode, type Profile, type Series } from './types';

const NO_DATA: Series = Array<number | null>(SLOTS_PER_DAY).fill(null);

/** Chance the station is empty (bikes mode) or full (docks mode), per slot. */
export function probabilities(profile: Profile | null, id: string, mode: Mode): Series {
  return profile?.stations[id]?.[mode === 'bikes' ? 'p_empty' : 'p_full'] ?? NO_DATA;
}

/** Typical bikes (bikes mode) or free docks (docks mode), per slot. */
export function counts(profile: Profile | null, id: string, mode: Mode): Series {
  return profile?.stations[id]?.[mode === 'bikes' ? 'bikes' : 'docks'] ?? NO_DATA;
}

/** Per-station value the map colours by. Stations missing from the profile are null (grey). */
export function stationFeatureStates(
  meta: Meta,
  profile: Profile | null,
  slot: number,
  mode: Mode,
): { id: string; p: number | null }[] {
  return meta.stations.map((s) => ({ id: s.id, p: probabilities(profile, s.id, mode)[slot] }));
}

export function stationsGeoJson(meta: Meta): FeatureCollection<Point, { id: string }> {
  return {
    type: 'FeatureCollection',
    features: meta.stations.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id },
    })),
  };
}

/** GBFS names are UPPERCASE: "PREŠERNOV TRG-PETKOVŠKOVO NABREŽJE" → "Prešernov Trg-Petkovškovo Nabrežje". */
export function titleCase(name: string): string {
  return name
    .toLocaleLowerCase('sl')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('sl'));
}

export function formatPercent(p: number | null): string {
  return p === null ? 'no data' : `${Math.round(p * 100)} %`;
}
