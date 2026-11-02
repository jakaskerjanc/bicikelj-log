import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TypicalPanel } from './controls/TypicalPanel';
import type { Day, Mode } from './data/types';
import { useTypical } from './data/useTypical';
import { StationMap } from './map/StationMap';
import { BottomSheet } from './station/BottomSheet';
import { StationDetail } from './station/StationDetail';
import { insideLjubljana } from './trip/boundary';
import { defaultTripTime } from './trip/time';
import { TripResultView } from './trip/TripResultView';
import { TripSearch } from './trip/TripSearch';
import type { LngLat, TripInputs } from './trip/types';
import { useTrip } from './trip/useTrip';
import { useIsDesktop } from './useIsDesktop';

interface Props {
  baseUrl: string;
  mapboxToken: string;
  initialDay: Day;
  initialSlot: number;
  /** The time at page load; the app keeps its own clock from here. */
  now: Date;
}

const NOTICE_MS = 3000;
const CLOCK_REFRESH_MS = 60_000;

/** The current time, re-read every minute and whenever the tab comes back, so a tab left open past midnight stays right. */
function useNow(initial: Date): Date {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = setInterval(refresh, CLOCK_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return now;
}

export function App({ baseUrl, mapboxToken, initialDay, initialSlot, now: initialNow }: Props) {
  const now = useNow(initialNow);
  const [day, setDay] = useState<Day>(initialDay);
  const [slot, setSlot] = useState(initialSlot);
  const [mode, setMode] = useState<Mode>('bikes');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { meta, profile, profiles, status, allStatus, retry } = useTypical(baseUrl, day);
  const desktop = useIsDesktop();

  const [tripInputs, setTripInputs] = useState<TripInputs>(() => ({
    from: null,
    to: null,
    timeMode: 'leave',
    risk: 'safe',
    ...defaultTripTime(now),
  }));
  const [tripOpen, setTripOpen] = useState(false);
  const [pickTarget, setPickTarget] = useState<'from' | 'to' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const trip = useTrip(mapboxToken, tripInputs, meta, profiles);
  const planning = trip.status !== 'idle';
  // The same object for as long as the result is unchanged, so the map doesn't redraw on every render.
  const tripResult = trip.status === 'ready' ? trip.result : null;
  const fromAt = tripInputs.from?.at ?? null;
  const toAt = tripInputs.to?.at ?? null;
  const endpoints = useMemo(() => ({ from: fromAt, to: toAt }), [fromAt, toAt]);
  const showBoundary = (!desktop && tripOpen) || pickTarget !== null || fromAt !== null || toAt !== null;

  // A station outline left over from before the trip would sit on a trip station.
  useEffect(() => {
    if (tripResult) setSelectedId(null);
  }, [tripResult]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const onPick = useCallback(
    (at: LngLat) => {
      if (!pickTarget) return;
      if (!insideLjubljana(at)) {
        setNotice('Pick a point inside Ljubljana');
        return;
      }
      setTripInputs((prev) => ({ ...prev, [pickTarget]: { name: 'Point on map', detail: '', at } }));
      setPickTarget(null);
    },
    [pickTarget],
  );

  const closeTrip = () => {
    setTripInputs((prev) => ({ ...prev, from: null, to: null }));
    setPickTarget(null);
    setTripOpen(false);
  };

  const station = meta?.stations.find((s) => s.id === selectedId) ?? null;
  const detail = station && (
    <StationDetail station={station} profile={profile} slot={slot} mode={mode} compact={!desktop} onSlot={setSlot} />
  );

  const availability = (
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
  );

  // A failed background prefetch would otherwise leave "Planning…" up forever.
  const tripBody = !planning ? null : allStatus === 'error' ? (
    <div className="trip-status">
      <p>Couldn&apos;t load data.</p>
      <button type="button" className="trip-retry" onClick={retry}>
        Retry
      </button>
    </div>
  ) : (
    <TripResultView state={trip} inputs={tripInputs} now={now} />
  );

  const search = (collapsible: boolean, children?: ReactNode) => (
    <TripSearch
      inputs={tripInputs}
      onInputs={setTripInputs}
      open={tripOpen}
      onOpen={() => setTripOpen(true)}
      onClose={closeTrip}
      collapsible={collapsible}
      pickTarget={pickTarget}
      onPickTarget={setPickTarget}
      stations={meta?.stations ?? []}
      token={mapboxToken}
      now={now}
      onNotice={setNotice}
    >
      {children}
    </TripSearch>
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
        trip={tripResult}
        endpoints={endpoints}
        showBoundary={showBoundary}
        onPick={pickTarget ? onPick : null}
      />
      {!desktop && detail && !planning && <BottomSheet onClose={() => setSelectedId(null)}>{detail}</BottomSheet>}
      {desktop ? (
        <div className="side">
          {search(false, tripBody)}
          {!planning && availability}
        </div>
      ) : (
        <>
          <div className="trip-top">{search(true)}</div>
          {planning && <div className="trip-dock">{tripBody}</div>}
          {!planning && availability}
        </>
      )}
      {notice && (
        <div role="alert" className="toast">
          {notice}
        </div>
      )}
    </div>
  );
}
