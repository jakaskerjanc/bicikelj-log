import { useState } from 'react';
import { TypicalPanel } from './controls/TypicalPanel';
import type { Day, Mode } from './data/types';
import { useTypical } from './data/useTypical';
import { StationMap } from './map/StationMap';
import { BottomSheet } from './station/BottomSheet';
import { StationDetail } from './station/StationDetail';
import { useIsDesktop } from './useIsDesktop';

interface Props {
  baseUrl: string;
  mapboxToken: string;
  initialDay: Day;
  initialSlot: number;
}

export function App({ baseUrl, mapboxToken, initialDay, initialSlot }: Props) {
  const [day, setDay] = useState<Day>(initialDay);
  const [slot, setSlot] = useState(initialSlot);
  const [mode, setMode] = useState<Mode>('bikes');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { meta, profile, status, retry } = useTypical(baseUrl, day);
  const desktop = useIsDesktop();

  const station = meta?.stations.find((s) => s.id === selectedId) ?? null;
  const detail = station && (
    <StationDetail station={station} profile={profile} slot={slot} mode={mode} compact={!desktop} onSlot={setSlot} />
  );

  return (
    <div className="app">
      <StationMap
        token={mapboxToken}
        meta={meta}
        profile={profile}
        slot={slot}
        mode={mode}
        selectedId={selectedId}
        onSelect={setSelectedId}
        popup={desktop ? detail : null}
        compact={!desktop}
      />
      {!desktop && detail && <BottomSheet onClose={() => setSelectedId(null)}>{detail}</BottomSheet>}
      <TypicalPanel
        day={day}
        slot={slot}
        mode={mode}
        onDay={setDay}
        onSlot={setSlot}
        onMode={setMode}
        status={status}
        daysUsed={profile?.days_used ?? null}
        onRetry={retry}
      />
    </div>
  );
}
