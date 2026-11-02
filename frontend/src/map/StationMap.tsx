import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { FeatureCollection, LineString } from 'geojson';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BUCKET_COLORS, NO_DATA_COLOR, THRESHOLDS } from '../data/colors';
import { stationFeatureStates, stationsGeoJson } from '../data/stations';
import type { Meta, Mode, Profile } from '../data/types';
import { LJUBLJANA_BOUNDARY } from '../trip/boundary';
import type { LngLat, TripResult } from '../trip/types';

const SOURCE = 'stations';
const LAYER = 'stations';
const ROUTE = 'route';
const BOUNDARY = 'boundary';
const LJUBLJANA: [number, number] = [14.5058, 46.0569];
/** Feature-state value for "no data": below every threshold, so `step` maps it to the grey output. */
const NO_DATA_P = -1;
/** About half the desktop popup's height: the dot sits this far below centre so dot + popup are centred together. */
const POPUP_HALF_HEIGHT = 110;
/** Opacity of the stations that are not part of the trip being shown. */
const FADED_OPACITY = 0.25;
const DEFAULT_FIT_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };

type RoutedTrip = Extract<TripResult, { kind: 'bike' | 'walk' }>;

/** The trip when it has a route to draw; a no-station result and no trip at all both give null. */
const routed = (trip: TripResult | null): RoutedTrip | null => (trip && trip.kind !== 'no-station' ? trip : null);

const FADED = ['boolean', ['feature-state', 'faded'], false] as const;

function routeGeoJson(trip: RoutedTrip | null): FeatureCollection<LineString, { leg: 'walk' | 'bike' }> {
  return {
    type: 'FeatureCollection',
    features: (trip?.legs ?? []).map((leg) => ({
      type: 'Feature',
      geometry: leg.geometry,
      properties: { leg: leg.mode },
    })),
  };
}

export type EndpointRole = 'from' | 'to';
const ROLES: EndpointRole[] = ['from', 'to'];
const PIN_LABEL: Record<EndpointRole, { letter: string; name: string }> = {
  from: { letter: 'A', name: 'Start' },
  to: { letter: 'B', name: 'Destination' },
};

/** A map pin (not a dot, so it can't be mistaken for a station) lettered A for the start and B for the destination. */
function endpointElement(role: EndpointRole): HTMLElement {
  const { letter, name } = PIN_LABEL[role];
  const el = document.createElement('div');
  el.className = `endpoint-pin endpoint-pin-${role}`;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${name}: drag to move, or click and then click the map`);
  el.title = `${name} — drag to move, or click and then click the map`;
  el.innerHTML =
    '<svg viewBox="0 0 30 40" width="30" height="40" aria-hidden="true">' +
    '<path d="M15 39C15 39 28 24 28 14A13 13 0 0 0 2 14C2 24 15 39 15 39Z"/>' +
    `<text x="15" y="19">${letter}</text></svg>`;
  return el;
}

export interface StationMapProps {
  token: string;
  meta: Meta | null;
  profile: Profile | null;
  slot: number;
  mode: Mode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  popup: ReactNode; // desktop popup content; null on mobile
  compact: boolean;
  /** The planned trip to draw; every station not on it is faded. */
  trip: TripResult | null;
  endpoints: { from: LngLat | null; to: LngLat | null };
  showBoundary: boolean;
  /** When set, a map click picks that point instead of selecting a station. */
  onPick: ((at: LngLat) => void) | null;
  /** A start or destination pin was dragged to `at`; false refuses the move and the pin goes back. */
  onMoveEndpoint?: (role: EndpointRole, at: LngLat) => boolean;
  /** A start or destination pin was clicked (not dragged). */
  onEndpointClick?: (role: EndpointRole) => void;
  /** Pixels of the map the trip's route must stay clear of when it is fitted (UI floating over the map). */
  fitPadding?: { top: number; right: number; bottom: number; left: number };
}

export function StationMap({
  token,
  meta,
  profile,
  slot,
  mode,
  selectedId,
  onSelect,
  popup,
  compact,
  trip,
  endpoints,
  showBoundary,
  onPick,
  onMoveEndpoint,
  onEndpointClick,
  fitPadding = DEFAULT_FIT_PADDING,
}: StationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const onPickRef = useRef(onPick);
  const tripRef = useRef(trip);
  const selectedIdRef = useRef(selectedId);
  const fitPaddingRef = useRef(fitPadding);
  const endpointsRef = useRef(endpoints);
  const onMoveEndpointRef = useRef(onMoveEndpoint);
  const onEndpointClickRef = useRef(onEndpointClick);
  const markersRef = useRef<Partial<Record<EndpointRole, mapboxgl.Marker>>>({});
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [popupNode, setPopupNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onPickRef.current = onPick;
    tripRef.current = trip;
    selectedIdRef.current = selectedId;
    fitPaddingRef.current = fitPadding;
    endpointsRef.current = endpoints;
    onMoveEndpointRef.current = onMoveEndpoint;
    onEndpointClickRef.current = onEndpointClick;
  });

  // Create the map once per token.
  useEffect(() => {
    if (!containerRef.current) return;
    let map: mapboxgl.Map;
    mapboxgl.accessToken = token;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: LJUBLJANA,
        zoom: 12,
      });
    } catch {
      setFailed(true); // e.g. no WebGL
      return;
    }
    mapRef.current = map;
    map.on('load', () => setLoaded(true));
    map.on('error', (e) => {
      if ((e.error as { status?: number } | undefined)?.status === 401) setFailed(true); // token rejected
    });
    map.on('click', (e) => {
      if (onPickRef.current) {
        onPickRef.current({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        return;
      }
      if (routed(tripRef.current)) return; // the trip's stations are not selectable
      const hit = map.getLayer(LAYER) ? map.queryRenderedFeatures(e.point, { layers: [LAYER] })[0] : undefined;
      onSelectRef.current(hit ? String(hit.properties?.id) : null);
    });
    // Mapbox only tracks window resizes; the mobile sheet resizes the map area on its own.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      for (const marker of Object.values(markersRef.current)) marker.remove();
      markersRef.current = {};
      mapRef.current = null;
      setLoaded(false);
      map.remove();
    };
  }, [token]);

  // Add the stations source + layer once the style and meta are both ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !meta || map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: stationsGeoJson(meta), promoteId: 'id' });
    map.addLayer({
      id: LAYER,
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-color': [
          'step',
          ['coalesce', ['feature-state', 'p'], NO_DATA_P],
          NO_DATA_COLOR,
          0,
          BUCKET_COLORS[0],
          THRESHOLDS[0],
          BUCKET_COLORS[1],
          THRESHOLDS[1],
          BUCKET_COLORS[2],
          THRESHOLDS[2],
          BUCKET_COLORS[3],
        ],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 11],
        'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#202124', '#ffffff'],
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.5],
        'circle-opacity': ['case', FADED, FADED_OPACITY, 1],
        'circle-stroke-opacity': ['case', FADED, FADED_OPACITY, 1],
      },
    });
    // The overlays go underneath the stations; the start and destination pins are DOM markers, always on top.
    map.addSource(BOUNDARY, { type: 'geojson', data: LJUBLJANA_BOUNDARY });
    map.addLayer(
      {
        id: BOUNDARY,
        type: 'line',
        source: BOUNDARY,
        layout: { visibility: 'none' },
        paint: { 'line-color': '#5f6368', 'line-opacity': 0.6, 'line-width': 2, 'line-dasharray': [2, 2] },
      },
      LAYER,
    );
    map.addSource(ROUTE, { type: 'geojson', data: routeGeoJson(null) });
    map.addLayer(
      {
        id: 'route-walk',
        type: 'line',
        source: ROUTE,
        filter: ['==', ['get', 'leg'], 'walk'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#5f6368', 'line-width': 3, 'line-dasharray': [0.5, 2] },
      },
      LAYER,
    );
    map.addLayer(
      {
        id: 'route-bike',
        type: 'line',
        source: ROUTE,
        filter: ['==', ['get', 'leg'], 'bike'],
        paint: { 'line-color': '#0b7a75', 'line-width': 5 },
      },
      LAYER,
    );
    map.on('mouseenter', LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LAYER, () => {
      map.getCanvas().style.cursor = '';
    });
    const bounds = new mapboxgl.LngLatBounds();
    for (const s of meta.stations) bounds.extend([s.lon, s.lat]);
    map.fitBounds(bounds, { padding: 40, duration: 0 });
  }, [loaded, meta]);

  // Recolour on every day/slot/mode/trip change: feature-state only, the source is never rebuilt.
  // While a trip is shown every station is faded, except the bike pickup and drop-off, which show their odds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !meta || !map.getSource(SOURCE)) return;
    const shown = routed(trip);
    const highlighted = new Map<string, number>(); // station id -> p
    if (shown?.kind === 'bike') {
      for (const { station, chance } of [shown.pickup, shown.dropoff]) {
        highlighted.set(station.id, chance === null ? NO_DATA_P : 1 - chance);
      }
    }
    for (const { id, p } of stationFeatureStates(meta, profile, slot, mode)) {
      const tripP = highlighted.get(id);
      map.setFeatureState(
        { source: SOURCE, id },
        tripP === undefined ? { p: p ?? NO_DATA_P, faded: shown !== null } : { p: tripP, faded: false, selected: true },
      );
    }
    return () => {
      if (mapRef.current !== map) return;
      for (const id of highlighted.keys()) {
        map.setFeatureState({ source: SOURCE, id }, { selected: id === selectedIdRef.current });
      }
    };
  }, [loaded, meta, profile, slot, mode, trip]);

  // Draw the trip's route, and fit the map to it once per new result (not on every recolour or padding change).
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource<mapboxgl.GeoJSONSource>(ROUTE);
    if (!map || !loaded || !meta || !source) return;
    const shown = routed(trip);
    source.setData(routeGeoJson(shown));
    if (!shown) return;
    const bounds = new mapboxgl.LngLatBounds();
    for (const leg of shown.legs) {
      for (const [lon, lat] of leg.geometry.coordinates) bounds.extend([lon, lat]);
    }
    map.fitBounds(bounds, { padding: fitPaddingRef.current });
  }, [loaded, meta, trip]);

  // The start and destination pins: created when a point is first set, moved after, removed when cleared.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const positions = { from: endpoints.from, to: endpoints.to };
    for (const role of ROLES) {
      const at = positions[role];
      let marker = markersRef.current[role];
      if (!at) {
        marker?.remove();
        delete markersRef.current[role];
        continue;
      }
      if (!marker) {
        const element = endpointElement(role);
        const created = new mapboxgl.Marker({ element, anchor: 'bottom', draggable: true });
        // A mouse drag ends in a click on the pin too; that click must not also start picking. A touch
        // drag ends without one, so the flag is reset on every new press rather than by the click.
        let dragged = false;
        element.addEventListener('pointerdown', () => {
          dragged = false;
        });
        created.on('dragstart', () => {
          dragged = true;
        });
        created.on('dragend', () => {
          const { lng, lat } = created.getLngLat();
          if (onMoveEndpointRef.current?.(role, { lon: lng, lat })) return;
          const back = endpointsRef.current[role];
          if (back) created.setLngLat([back.lon, back.lat]);
        });
        element.addEventListener('click', (e) => {
          e.stopPropagation(); // not a map click: no pick, no station selection
          if (!dragged) onEndpointClickRef.current?.(role);
        });
        marker = created.setLngLat([at.lon, at.lat]).addTo(map);
        markersRef.current[role] = marker;
      }
      marker.setLngLat([at.lon, at.lat]);
    }
  }, [loaded, endpoints.from, endpoints.to]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !meta || !map.getLayer(BOUNDARY)) return;
    map.setLayoutProperty(BOUNDARY, 'visibility', showBoundary ? 'visible' : 'none');
  }, [loaded, meta, showBoundary]);

  // Selection: outline and centre the station; desktop also opens a popup, mobile has the sheet below.
  useEffect(() => {
    const map = mapRef.current;
    const station = meta?.stations.find((s) => s.id === selectedId);
    if (!map || !loaded || !station || !map.getSource(SOURCE)) return;
    map.setFeatureState({ source: SOURCE, id: station.id }, { selected: true });
    map.easeTo({ center: [station.lon, station.lat], offset: [0, compact ? 0 : POPUP_HALF_HEIGHT] });
    let popupObj: mapboxgl.Popup | null = null;
    let resizeObserver: ResizeObserver | null = null;
    if (!compact) {
      const node = document.createElement('div');
      popupObj = new mapboxgl.Popup({ closeOnClick: false, maxWidth: '320px', offset: 12 })
        .setLngLat([station.lon, station.lat])
        .setDOMContent(node)
        .addTo(map);
      // Only a user close (×) deselects; our own remove() below clears popupObj first.
      popupObj.on('close', () => {
        if (popupObj) onSelectRef.current(null);
      });
      // The popup is added empty and React fills it later, so Mapbox's above/below anchor would be
      // chosen from a zero-size box. setLngLat re-runs the placement whenever the content resizes.
      const lngLat: [number, number] = [station.lon, station.lat];
      resizeObserver = new ResizeObserver(() => popupObj?.setLngLat(lngLat));
      resizeObserver.observe(node);
      setPopupNode(node);
    }
    return () => {
      resizeObserver?.disconnect();
      const toRemove = popupObj;
      popupObj = null;
      toRemove?.remove();
      setPopupNode(null);
      if (mapRef.current === map) map.setFeatureState({ source: SOURCE, id: station.id }, { selected: false });
    };
  }, [loaded, meta, selectedId, compact]);

  return (
    <div className="map-wrap">
      <div className="map" ref={containerRef} />
      {failed && (
        <div className="map-failed" role="alert">
          Map failed to load
        </div>
      )}
      {popupNode && popup ? createPortal(popup, popupNode) : null}
    </div>
  );
}
