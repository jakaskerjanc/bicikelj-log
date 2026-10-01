import { colorFor } from '../data/colors';
import { TICK_SLOTS, hourly, slotLabel } from '../data/slots';
import { formatPercent } from '../data/stations';
import { SLOTS_PER_DAY, type Series } from '../data/types';

interface Props {
  values: Series; // 96 slot probabilities
  slot: number;
  compact: boolean; // phones: 24 hourly bars instead of 96
  onSelect: (slot: number) => void;
}

export function DayChart({ values, slot, compact, onSelect }: Props) {
  const slotsPerBar = compact ? 4 : 1;
  const bars = compact ? hourly(values) : values;
  const selected = Math.floor(slot / slotsPerBar);
  return (
    <div className="day-chart">
      <div className="bars">
        {bars.map((p, i) => (
          <button
            key={i}
            type="button"
            className="bar-hit"
            aria-label={`${slotLabel(i * slotsPerBar)}: ${formatPercent(p)}`}
            aria-current={i === selected ? 'true' : undefined}
            onClick={() => onSelect(i * slotsPerBar)}
          >
            <span
              className="bar"
              style={{ height: p === null ? '4%' : `${Math.max(p * 100, 2)}%`, background: colorFor(p) }}
            />
          </button>
        ))}
      </div>
      <div className="ticks" aria-hidden="true">
        {TICK_SLOTS.map((t) => (
          <span key={t} style={{ left: `${(t / SLOTS_PER_DAY) * 100}%` }}>
            {slotLabel(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
