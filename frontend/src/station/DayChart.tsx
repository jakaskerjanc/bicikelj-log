import type { KeyboardEvent } from 'react';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';
import { TimeTicks } from '../controls/TimeTicks';
import { colorFor } from '../data/colors';
import { hourly, slotLabel } from '../data/slots';
import { formatPercent } from '../data/stations';
import { SLOTS_PER_DAY, type Mode, type Series } from '../data/types';

interface Props {
  counts: Series; // 96 slots of typical bikes / free docks: the bar height
  chances: Series; // 96 slots of chance empty / full: the bar colour
  capacity: number;
  mode: Mode;
  slot: number;
  compact: boolean; // phones: 24 hourly bars instead of 96
  onSelect: (slot: number) => void;
}

// Internal coordinates; the SVG stretches to the container width, so nothing is measured.
const W = 960;
const H = 64;
// Share of the height for an empty slot and for no data, so those bars stay visible and clickable.
const MIN_SHARE = 0.03;
const NO_DATA_SHARE = 0.06;

function barLabel(slot: number, count: number | null, chance: number | null, mode: Mode): string {
  if (count === null || chance === null) return `${slotLabel(slot)}: no data`;
  const [what, risk] = mode === 'bikes' ? ['bikes', 'empty'] : ['free docks', 'full'];
  return `${slotLabel(slot)}: ${Math.round(count)} ${what}, ${formatPercent(chance)} chance ${risk}`;
}

export function DayChart({ counts, chances, capacity, mode, slot, compact, onSelect }: Props) {
  const slotsPerBar = compact ? 4 : 1;
  const heights = compact ? hourly(counts) : counts;
  const colors = compact ? hourly(chances) : chances;
  const selected = Math.floor(slot / slotsPerBar);
  const x = scaleBand({ domain: heights.map((_, i) => i), range: [0, W], paddingInner: compact ? 0.08 : 0.2 });
  const y = scaleLinear({ domain: [0, 1], range: [0, H], clamp: true });
  return (
    <div className="day-chart">
      <svg className="bars" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {heights.map((count, i) => {
          const select = () => onSelect(i * slotsPerBar);
          // <g role="button"> doesn't get a native button's Enter/Space activation.
          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              select();
            }
          };
          const h = count === null ? y(NO_DATA_SHARE) : y(Math.max(capacity > 0 ? count / capacity : 0, MIN_SHARE));
          const left = x(i) ?? 0;
          return (
            <g
              key={i}
              className="bar-hit"
              role="button"
              tabIndex={0}
              aria-label={barLabel(i * slotsPerBar, count, colors[i], mode)}
              aria-current={i === selected ? 'true' : undefined}
              onClick={select}
              onKeyDown={onKeyDown}
            >
              {/* full-height hit area; tinted to mark the selected and focused column */}
              <rect className="bar-slot" x={left} y={0} width={x.bandwidth()} height={H} />
              <Bar className="bar" x={left} y={H - h} width={x.bandwidth()} height={h} fill={colorFor(colors[i])} />
            </g>
          );
        })}
      </svg>
      <TimeTicks span={SLOTS_PER_DAY} />
    </div>
  );
}
