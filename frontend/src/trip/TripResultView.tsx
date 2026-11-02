import type { ReactNode } from 'react';
import { colorFor } from '../data/colors';
import { titleCase } from '../data/stations';
import type { StationOdds, TripInputs } from './types';
import { formatClock } from './time';
import type { TripState } from './useTrip';

export interface TripResultViewProps {
  state: TripState;
  inputs: TripInputs;
}

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

/** `Bike likely · 9 in 10`; the count stays within 1..9 because no profile can promise 0 or 10. */
function chanceLabel(noun: 'Bike' | 'Free dock', chance: number | null): string {
  if (chance === null) return `${noun} chance unknown`;
  const word = chance >= 0.9 ? 'likely' : chance >= 0.5 ? 'possible' : 'unlikely';
  return `${noun} ${word} · ${Math.min(9, Math.max(1, Math.round(chance * 10)))} in 10`;
}

function Chance({ noun, odds }: { noun: 'Bike' | 'Free dock'; odds: StationOdds }) {
  return (
    <span
      className={odds.acceptable ? 'trip-chance' : 'trip-chance warn'}
      style={odds.chance === null ? undefined : { color: colorFor(1 - odds.chance) }}
    >
      {chanceLabel(noun, odds.chance)}
    </span>
  );
}

function Row({ mode, children }: { mode: 'walk' | 'bike'; children: ReactNode }) {
  return <li className={`trip-leg trip-leg-${mode}`}>{children}</li>;
}

export function TripResultView({ state, inputs }: TripResultViewProps) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <p className="trip-status">Planning…</p>;
  if (state.status === 'error') {
    return (
      <div className="trip-status">
        <p>Couldn&apos;t get the route.</p>
        <button type="button" className="trip-retry" onClick={state.retry}>
          Retry
        </button>
      </div>
    );
  }

  const { result } = state;
  if (result.kind === 'no-station') {
    return <p className="trip-status">No station within 1 km of the {result.end}</p>;
  }

  const destination = inputs.to?.name ?? '';
  const depart = formatClock(result.depart);
  const total = minutes((result.arrive.getTime() - result.depart.getTime()) / 1000);

  return (
    <div className="trip-result">
      {result.kind === 'walk' && <p className="trip-note">Walking is faster</p>}
      <p className="trip-header">
        <strong>{`${depart} → ${formatClock(result.arrive)}`}</strong> <span>{`${total} min`}</span>
      </p>
      {result.kind === 'bike' && inputs.timeMode === 'arrive' && (
        <p className="trip-note">{`Leave by ${depart} to arrive by ${formatClock(result.arrive)}`}</p>
      )}
      {result.kind === 'bike' && result.limitedData && <p className="trip-note muted">Limited data</p>}
      <ol className="trip-legs">
        {result.kind === 'walk' ? (
          <Row mode="walk">
            <span>{`Walk ${minutes(result.legs[0].durationS)} min to ${destination}`}</span>
          </Row>
        ) : (
          <>
            <Row mode="walk">
              <span>{`Walk ${minutes(result.legs[0].durationS)} min to ${titleCase(result.pickup.station.name)}`}</span>
              <Chance noun="Bike" odds={result.pickup} />
            </Row>
            <Row mode="bike">
              <span>{`Ride ${minutes(result.legs[1].durationS)} min to ${titleCase(result.dropoff.station.name)}`}</span>
              <Chance noun="Free dock" odds={result.dropoff} />
            </Row>
            <Row mode="walk">
              <span>{`Walk ${minutes(result.legs[2].durationS)} min to ${destination}`}</span>
            </Row>
          </>
        )}
      </ol>
    </div>
  );
}
