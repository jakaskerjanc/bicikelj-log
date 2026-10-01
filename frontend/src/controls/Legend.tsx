import { BUCKET_COLORS, legendLabels } from '../data/colors';
import type { Mode } from '../data/types';

export function Legend({ mode }: { mode: Mode }) {
  const { low, high } = legendLabels(mode);
  return (
    <div className="legend">
      <span>{low}</span>
      {BUCKET_COLORS.map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
      <span>{high}</span>
    </div>
  );
}
