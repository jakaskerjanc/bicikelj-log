import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BUCKET_COLORS, NO_DATA_COLOR, THRESHOLDS } from '../data/colors';
import { stationFeatureStates, stationsGeoJson } from '../data/stations';
import type { Meta, Mode, Profile } from '../data/types';

const SOURCE = 'stations';
const LAYER = 'stations';
const LJUBLJANA: [number, number] = [14.5058, 46.0569];
/** Feature-state value for "no data": below every threshold, so `step` maps it to the grey output. */
const NO_DATA_P = -1;

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
}

export function StationMap({ token, meta, profile, slot, mode, selectedId, onSelect, popup, compact }: StationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [popupNode, setPopupNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
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
      const hit = map.getLayer(LAYER) ? map.queryRenderedFeatures(e.point, { layers: [LAYER] })[0] : undefined;
      onSelectRef.current(hit ? String(hit.properties?.id) : null);
    });
    return () => {
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
      },
    });
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

  // Recolour on every day/slot/mode change: feature-state only, the source is never rebuilt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !meta || !map.getSource(SOURCE)) return;
    for (const { id, p } of stationFeatureStates(meta, profile, slot, mode)) {
      map.setFeatureState({ source: SOURCE, id }, { p: p ?? NO_DATA_P });
    }
  }, [loaded, meta, profile, slot, mode]);

  // Selection: outline the station; desktop opens a popup, mobile centres it above the sheet.
  useEffect(() => {
    const map = mapRef.current;
    const station = meta?.stations.find((s) => s.id === selectedId);
    if (!map || !loaded || !station || !map.getSource(SOURCE)) return;
    map.setFeatureState({ source: SOURCE, id: station.id }, { selected: true });
    let popupObj: mapboxgl.Popup | null = null;
    if (compact) {
      map.easeTo({ center: [station.lon, station.lat] });
    } else {
      const node = document.createElement('div');
      popupObj = new mapboxgl.Popup({ closeOnClick: false, maxWidth: '320px', offset: 12 })
        .setLngLat([station.lon, station.lat])
        .setDOMContent(node)
        .addTo(map);
      // Only a user close (×) deselects; our own remove() below clears popupObj first.
      popupObj.on('close', () => {
        if (popupObj) onSelectRef.current(null);
      });
      setPopupNode(node);
    }
    return () => {
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
