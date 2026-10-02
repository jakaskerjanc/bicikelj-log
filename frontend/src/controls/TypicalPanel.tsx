import { dayName, slotLabel } from '../data/slots';
import type { Day, Mode } from '../data/types';
import type { LoadStatus } from '../data/useTypical';
import { DayChips } from './DayChips';
import { Legend } from './Legend';
import { ModeToggle } from './ModeToggle';
import { TimeSlider } from './TimeSlider';

/** Below this many (recency-weighted) days of history the profile is flagged as thin. */
export const LIMITED_DATA_DAYS = 2;

export interface TypicalPanelProps {
  day: Day;
  slot: number;
  mode: Mode;
  onDay: (day: Day) => void;
  onSlot: (slot: number) => void;
  onMode: (mode: Mode) => void;
  status: LoadStatus;
  daysUsed: number | null;
  onRetry: () => void;
}

export function TypicalPanel(props: TypicalPanelProps) {
  const { day, slot, mode, status, daysUsed } = props;
  return (
    <section className="panel" aria-label="Typical availability">
      <div className="panel-row">
        <h1 className="panel-title">Typical availability</h1>
        <Legend mode={mode} />
        <ModeToggle mode={mode} onChange={props.onMode} />
      </div>
      <div className="panel-row panel-time">
        <DayChips day={day} onChange={props.onDay} />
        <TimeSlider slot={slot} onChange={props.onSlot} />
      </div>
      <div className="panel-row panel-status">
        <span className="when">{`${dayName(day)}, ${slotLabel(slot)}`}</span>
        {status === 'loading' && <span className="skeleton" role="status" aria-label="Loading data" />}
        {status === 'error' && (
          <span className="error" role="alert">
            Couldn't load data.{' '}
            <button type="button" onClick={props.onRetry}>
              Retry
            </button>
          </span>
        )}
        {status === 'ready' && daysUsed !== null && daysUsed < LIMITED_DATA_DAYS && (
          <span className="muted">Limited data</span>
        )}
      </div>
    </section>
  );
}
