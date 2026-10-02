import { counts, formatPercent, probabilities, titleCase } from '../data/stations';
import type { Mode, Profile, Station } from '../data/types';
import { DayChart } from './DayChart';

interface Props {
  station: Station;
  profile: Profile | null;
  slot: number;
  mode: Mode;
  compact: boolean;
  onSlot: (slot: number) => void;
}

export function StationDetail({ station, profile, slot, mode, compact, onSlot }: Props) {
  const probs = probabilities(profile, station.id, mode);
  const typical = counts(profile, station.id, mode);
  const count = typical[slot];
  const p = probs[slot];
  const bikes = mode === 'bikes';
  return (
    <div className="station-detail">
      <h2>{titleCase(station.name)}</h2>
      {count === null || p === null ? (
        <p>No data for this time</p>
      ) : (
        <p>
          Typically <strong>{Math.round(count)}</strong> {bikes ? 'bikes' : 'free docks'} ·{' '}
          <strong>{formatPercent(p)}</strong> chance {bikes ? 'empty' : 'full'}
        </p>
      )}
      <p className="muted">Capacity {station.capacity}</p>
      <DayChart
        counts={typical}
        chances={probs}
        capacity={station.capacity}
        mode={mode}
        slot={slot}
        compact={compact}
        onSelect={onSlot}
      />
    </div>
  );
}
