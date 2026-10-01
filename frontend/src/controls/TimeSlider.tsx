import { TICK_SLOTS, slotLabel } from '../data/slots';
import { SLOTS_PER_DAY } from '../data/types';

interface Props {
  slot: number;
  onChange: (slot: number) => void;
}

export function TimeSlider({ slot, onChange }: Props) {
  return (
    <div className="time-slider">
      <input
        type="range"
        min={0}
        max={SLOTS_PER_DAY - 1}
        step={1}
        value={slot}
        aria-label="Time of day"
        aria-valuetext={slotLabel(slot)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="ticks" aria-hidden="true">
        {TICK_SLOTS.map((t) => (
          <span key={t} style={{ left: `${(t / (SLOTS_PER_DAY - 1)) * 100}%` }}>
            {slotLabel(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
