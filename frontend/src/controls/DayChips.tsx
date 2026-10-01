import { dayName } from '../data/slots';
import { DAYS, type Day } from '../data/types';

interface Props {
  day: Day;
  onChange: (day: Day) => void;
}

export function DayChips({ day, onChange }: Props) {
  return (
    <div className="day-chips" role="group" aria-label="Day of week">
      {DAYS.map((d) => (
        <button
          key={d}
          type="button"
          className="chip"
          aria-label={dayName(d)}
          aria-pressed={d === day}
          onClick={() => onChange(d)}
        >
          {dayName(d)[0]}
        </button>
      ))}
    </div>
  );
}
