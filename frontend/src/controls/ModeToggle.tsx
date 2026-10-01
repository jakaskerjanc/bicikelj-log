import type { Mode } from '../data/types';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'bikes', label: 'Bikes' },
  { mode: 'docks', label: 'Docks' },
];

interface Props {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="mode-toggle" role="group" aria-label="Show availability of">
      {MODES.map((m) => (
        <button key={m.mode} type="button" aria-pressed={m.mode === mode} onClick={() => onChange(m.mode)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
