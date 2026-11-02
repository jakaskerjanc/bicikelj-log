import { useCallback, useEffect, useMemo, useState } from 'react';
import { TypicalPanel } from './controls/TypicalPanel';
import type { Day, Mode } from './data/types';
import { useTypical } from './data/useTypical';
import { StationMap, type EndpointRole } from './map/StationMap';
import { BottomSheet } from './station/BottomSheet';
import { StationDetail } from './station/StationDetail';
import { insideLjubljana } from './trip/boundary';
import { dayName } from './data/slots';
import { formatClock, ljubljanaInstant, tripWhen, weekdayOf } from './trip/time';
import { TripResultView } from './trip/TripResultView';
import { TripSearch } from './trip/TripSearch';
import type { LngLat, TripChoice, TripInputs } from './trip/types';
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

// The route is fitted into the part of the map the trip UI leaves free.
/** Desktop: the 440 px side column (plus its 12 px inset and some air) covers the left. */
const DESKTOP_FIT_PADDING = { top: 60, right: 60, bottom: 60, left: 12 + 440 + 40 };
/** Mobile: the open trip card covers the top; used until it has been measured. */
const TOP_CARD_FALLBACK_PX = 220;
const TOP_CARD_GAP_PX = 24;

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

/** A callback ref for an element, and that element's height once it has been laid out (null before). */
function useHeight(): [(el: HTMLDivElement | null) => void, number | null] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setHeight(Math.ceil(entry.contentRect.height)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, height];
}

export function App({ baseUrl, mapboxToken, initialDay, initialSlot, now: initialNow }: Props) {
  const now = useNow(initialNow);
  const [day, setDay] = useState<Day>(initialDay);
  const [slot, setSlot] = useState(initialSlot);
  const [mode, setMode] = useState<Mode>('bikes');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { meta, profile, profiles, status, allStatus, retry } = useTypical(baseUrl, day);
  const desktop = useIsDesktop();

  const [tripChoice, setTripChoice] = useState<TripChoice>({ from: null, to: null, timeMode: 'leave', risk: 'safe' });
  // One day and time picker for both: the trip leaves (or arrives) at the availability panel's day and slot.
  const tripTime = tripWhen(day, slot, now);
  const tripInputs: TripInputs = { ...tripChoice, ...tripTime };
  const [tripOpen, setTripOpen] = useState(false);
  const [pickTarget, setPickTarget] = useState<'from' | 'to' | null>(null);
  // The id makes each notice a new object, so two identical ones each get the full time on screen.
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const showNotice = useCallback((text: string) => setNotice((prev) => ({ text, id: (prev?.id ?? 0) + 1 })), []);

  const [topCardRef, topCardHeight] = useHeight();
  const fitPadding = useMemo(
    () =>
      desktop
        ? DESKTOP_FIT_PADDING
        : { top: (topCardHeight ?? TOP_CARD_FALLBACK_PX) + TOP_CARD_GAP_PX, right: 40, bottom: 40, left: 40 },
    [desktop, topCardHeight],
  );

  const trip = useTrip(mapboxToken, tripInputs, meta, profiles);
  const planning = trip.status !== 'idle';
  // The same object for as long as the result is unchanged, so the map doesn't redraw on every render.
  const tripResult = trip.status === 'ready' ? trip.result : null;
  const fromAt = tripInputs.from?.at ?? null;
  const toAt = tripInputs.to?.at ?? null;
  const endpoints = useMemo(() => ({ from: fromAt, to: toAt }), [fromAt, toAt]);
  const showBoundary = (!desktop && tripOpen) || pickTarget !== null || fromAt !== null || toAt !== null;

  // A station outline left over from before the trip would sit on a trip station, and a selected station
  // would bring its sheet back up once the trip is closed.
  useEffect(() => {
    if (planning) setSelectedId(null);
  }, [planning, tripResult]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  /** Set the start or destination to a point chosen on the map; false (with a notice) if it is outside Ljubljana. */
  const placeOnMap = useCallback(
    (role: EndpointRole, at: LngLat): boolean => {
      if (!insideLjubljana(at)) {
        showNotice('Pick a point inside Ljubljana');
        return false;
      }
      setTripChoice((prev) => ({ ...prev, [role]: { name: 'Point on map', detail: '', at } }));
      setPickTarget((target) => (target === role ? null : target));
      return true;
    },
    [showNotice],
  );

  const onPick = useCallback(
    (at: LngLat) => {
      if (pickTarget) placeOnMap(pickTarget, at);
    },
    [pickTarget, placeOnMap],
  );

  // Clicking a pin moves it with the next map click; clicking it again cancels that.
  const onEndpointClick = useCallback((role: EndpointRole) => {
    setPickTarget((target) => (target === role ? null : role));
  }, []);

  const closeTrip = () => {
    setTripChoice((prev) => ({ ...prev, from: null, to: null }));
    setPickTarget(null);
    setTripOpen(false);
    setSelectedId(null);
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
      tripLabel={
        planning
          ? `${tripChoice.timeMode === 'leave' ? 'Leave at' : 'Arrive by'} ${dayName(weekdayOf(tripTime.date))}, ${formatClock(
              ljubljanaInstant(tripTime.date, tripTime.time),
            )}`
          : undefined
      }
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

  const search = (collapsible: boolean) => (
    <TripSearch
      inputs={tripChoice}
      onInputs={setTripChoice}
      open={tripOpen}
      onOpen={() => setTripOpen(true)}
      onClose={closeTrip}
      collapsible={collapsible}
      pickTarget={pickTarget}
      onPickTarget={setPickTarget}
      stations={meta?.stations ?? []}
      token={mapboxToken}
      onNotice={showNotice}
    />
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
        onMoveEndpoint={placeOnMap}
        onEndpointClick={onEndpointClick}
        fitPadding={fitPadding}
      />
      {!desktop && detail && !planning && <BottomSheet onClose={() => setSelectedId(null)}>{detail}</BottomSheet>}
      {desktop ? (
        <div className="side">
          {search(false)}
          {/* The picker sits above the result, so a result changing height (Planning… while a new time is
              planned) never moves it. */}
          {availability}
          {tripBody && (
            <section className="trip-result-card" aria-label="Trip result">
              {tripBody}
            </section>
          )}
        </div>
      ) : (
        <>
          <div className="trip-top" ref={topCardRef}>{search(true)}</div>
          {planning && <div className="trip-dock">{tripBody}</div>}
          {availability}
        </>
      )}
      {notice && (
        <div role="alert" className="toast">
          {notice.text}
        </div>
      )}
    </div>
  );
}
