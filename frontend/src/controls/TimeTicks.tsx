import { TICK_SLOTS, slotLabel } from '../data/slots';

interface Props {
  /** Slot count the tick positions are relative to (the slider's thumb travels 0…95, the chart spans 96 bars). */
  span: number;
}

/** Tick marks with compact hour labels ("3 AM"); seven full "3:00 AM" labels would not fit a phone. */
export function TimeTicks({ span }: Props) {
  return (
    <div className="ticks" aria-hidden="true">
      {TICK_SLOTS.map((t) => (
        <span key={t} style={{ left: `${(t / span) * 100}%` }}>
          {slotLabel(t).replace(':00', '')}
        </span>
      ))}
    </div>
  );
}
