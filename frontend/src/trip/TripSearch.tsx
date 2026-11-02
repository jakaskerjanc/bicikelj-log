import type { ReactNode } from 'react';
import type { Station } from '../data/types';
import { PlaceField } from './PlaceField';
import { formatDateOption, tripDates } from './time';
import type { Risk, TimeMode, TripInputs } from './types';

export interface TripSearchProps {
  inputs: TripInputs;
  onInputs: (next: TripInputs) => void;
  open: boolean;
  onOpen: () => void;
  /** Clears the trip. */
  onClose: () => void;
  /** True on mobile: while closed, only the "Where to?" pill shows. */
  collapsible: boolean;
  pickTarget: 'from' | 'to' | null;
  onPickTarget: (t: 'from' | 'to' | null) => void;
  stations: Station[];
  token: string;
  now: Date;
  onNotice: (msg: string) => void;
  /** Desktop: the result, rendered inside the card. */
  children?: ReactNode;
}

const TIME_MODES: { mode: TimeMode; label: string }[] = [
  { mode: 'leave', label: 'Leave at' },
  { mode: 'arrive', label: 'Arrive by' },
];

const RISKS: { risk: Risk; label: string }[] = [
  { risk: 'safe', label: 'Safe' },
  { risk: 'risky', label: 'Risky' },
];

export function TripSearch({
  inputs,
  onInputs,
  open,
  onOpen,
  onClose,
  collapsible,
  pickTarget,
  onPickTarget,
  stations,
  token,
  now,
  onNotice,
  children,
}: TripSearchProps) {
  if (collapsible && !open) {
    return (
      <button type="button" className="trip-pill" onClick={onOpen}>
        Where to?
      </button>
    );
  }

  const dates = tripDates(now);
  // Keep a stale selected date (page left open past midnight) visible instead of silently showing another.
  const options = dates.includes(inputs.date) ? dates : [inputs.date, ...dates];
  const field = (which: 'from' | 'to') => (
    <PlaceField
      label={which === 'from' ? 'From' : 'To'}
      value={inputs[which]}
      onChange={(place) => onInputs({ ...inputs, [which]: place })}
      stations={stations}
      token={token}
      allowMyLocation={which === 'from'}
      onChooseOnMap={() => onPickTarget(which)}
      onNotice={onNotice}
    />
  );

  return (
    <section className="trip-search" aria-label="Trip planner">
      <div className="trip-fields">
        <div className="trip-places">
          {field('from')}
          {field('to')}
        </div>
        <button
          type="button"
          className="trip-icon-btn"
          aria-label="Swap"
          onClick={() => onInputs({ ...inputs, from: inputs.to, to: inputs.from })}
        >
          ⇅
        </button>
        <button type="button" className="trip-icon-btn" aria-label="Close trip" onClick={onClose}>
          ×
        </button>
      </div>
      {pickTarget && (
        <p className="trip-hint" role="status">
          {pickTarget === 'from' ? 'Tap the map to set the start' : 'Tap the map to set the destination'}
        </p>
      )}
      <div className="trip-row">
        <div className="trip-toggle" role="group" aria-label="Time is for">
          {TIME_MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={inputs.timeMode === m.mode}
              onClick={() => onInputs({ ...inputs, timeMode: m.mode })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <input
          type="time"
          step={300}
          className="trip-time"
          aria-label="Time"
          value={inputs.time}
          onChange={(e) => onInputs({ ...inputs, time: e.target.value })}
        />
        <select
          className="trip-date"
          aria-label="Date"
          value={inputs.date}
          onChange={(e) => onInputs({ ...inputs, date: e.target.value })}
        >
          {options.map((d) => (
            <option key={d} value={d}>
              {formatDateOption(d, dates[0])}
            </option>
          ))}
        </select>
        <div className="trip-toggle" role="group" aria-label="Risk of a bad station">
          {RISKS.map((r) => (
            <button
              key={r.risk}
              type="button"
              aria-pressed={inputs.risk === r.risk}
              onClick={() => onInputs({ ...inputs, risk: r.risk })}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {children}
    </section>
  );
}
