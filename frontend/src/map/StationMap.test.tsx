import { act, render } from '@testing-library/react';
import type { FeatureCollection } from 'geojson';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Leg, TripResult } from '../trip/types';
import { META, makeProfile, series, stationSeries } from '../test/fixtures';
import { StationMap, type StationMapProps } from './StationMap';

const resize = vi.fn();
const easeTo = vi.fn();
const addLayer = vi.fn();
const setLayoutProperty = vi.fn();
const setFeatureState = vi.fn();
const fitBounds = vi.fn();
const queryRenderedFeatures = vi.fn();
/** Every GeoJSONSource.setData call, tagged with the source it went to. */
const setDataCalls: { source: string; data: unknown }[] = [];
let fireLoad = () => {};
let fireClick: (e: unknown) => void = () => {};

// mapbox-gl needs WebGL; this stand-in only keeps the state StationMap reads back.
vi.mock('mapbox-gl', () => {
  class Map {
    private sources = new Set<string>();
    private layers = new Set<string>();
    resize = resize;
    easeTo = easeTo;
    addLayer = (layer: { id: string }, beforeId?: string) => {
      this.layers.add(layer.id);
      addLayer(layer, beforeId);
    };
    setLayoutProperty = setLayoutProperty;
    setFeatureState = setFeatureState;
    fitBounds = fitBounds;
    queryRenderedFeatures = queryRenderedFeatures;
    on(event: string, handler: () => void) {
      if (event === 'load') fireLoad = handler;
      if (event === 'click') fireClick = handler;
    }
    addSource(id: string) {
      this.sources.add(id);
    }
    getSource(id: string) {
      return this.sources.has(id) ? { setData: (data: unknown) => setDataCalls.push({ source: id, data }) } : undefined;
    }
    getLayer(id: string) {
      return this.layers.has(id) ? {} : undefined;
    }
    getCanvas() {
      return { style: {} };
    }
    remove() {}
  }
  class Popup {
    setLngLat() {
      return this;
    }
    setDOMContent() {
      return this;
    }
    addTo() {
      return this;
    }
    on() {}
    remove() {}
  }
  class LngLatBounds {
    points: [number, number][] = [];
    extend(point: [number, number]) {
      this.points.push(point);
      return this;
    }
  }
  return { default: { Map, Popup, LngLatBounds } };
});

const observed: { callback: ResizeObserverCallback; target: Element }[] = [];

beforeEach(() => {
  for (const fn of [resize, easeTo, addLayer, setLayoutProperty, setFeatureState, fitBounds, queryRenderedFeatures]) fn.mockClear();
  setDataCalls.length = 0;
  observed.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        observed.push({ callback: this.callback, target });
      }
      disconnect() {}
    },
  );
});

const BASE_PROPS: StationMapProps = {
  token: 'pk.test',
  meta: META,
  profile: null,
  slot: 0,
  mode: 'bikes',
  selectedId: null,
  onSelect: vi.fn(),
  popup: null,
  compact: true,
  trip: null,
  endpoints: { from: null, to: null },
  showBoundary: false,
  onPick: null,
};

function renderMap(props: Partial<StationMapProps> = {}) {
  return render(<StationMap {...BASE_PROPS} {...props} />);
}

const leg = (mode: Leg['mode'], coordinates: [number, number][]): Leg => ({
  mode,
  durationS: 60,
  distanceM: 100,
  geometry: { type: 'LineString', coordinates },
});

const WALK_1 = leg('walk', [[14.5, 46.04], [14.503, 46.05]]);
const RIDE = leg('bike', [[14.503, 46.05], [14.506, 46.0514]]);
const WALK_2 = leg('walk', [[14.506, 46.0514], [14.51, 46.06]]);

function bikeTrip(pickupChance: number | null, dropoffChance: number | null): TripResult {
  return {
    kind: 'bike',
    depart: new Date('2026-11-02T10:00:00Z'),
    arrive: new Date('2026-11-02T10:20:00Z'),
    legs: [WALK_1, RIDE, WALK_2],
    pickup: { station: META.stations[1], chance: pickupChance, acceptable: true },
    dropoff: { station: META.stations[0], chance: dropoffChance, acceptable: true },
    limitedData: false,
  };
}

const WALK_TRIP: TripResult = {
  kind: 'walk',
  depart: new Date('2026-11-02T10:00:00Z'),
  arrive: new Date('2026-11-02T10:20:00Z'),
  legs: [WALK_1],
};

const stateOf = (id: string) => setFeatureState.mock.calls.filter(([f]) => f.id === id).map(([, state]) => state);
const lastStateOf = (id: string) => Object.assign({}, ...stateOf(id));
const routeData = () => setDataCalls.filter((c) => c.source === 'route').at(-1)?.data as FeatureCollection;

describe('StationMap', () => {
  it('resizes the map when its container changes size, not only on window resize', () => {
    // The mobile bottom sheet grows and shrinks the map area without any window resize event.
    const { container } = renderMap();
    const map = container.querySelector('.map')!;
    const watcher = observed.find((o) => o.target === map);
    expect(watcher).toBeDefined();
    watcher!.callback([], {} as ResizeObserver);
    expect(resize).toHaveBeenCalled();
  });

  it.each([
    ['mobile', true],
    ['desktop', false],
  ])('%s: selecting a station centres the map on it', (_, compact) => {
    const station = META.stations[0];
    const { rerender } = renderMap({ compact });
    act(() => fireLoad());
    rerender(<StationMap {...BASE_PROPS} selectedId={station.id} compact={compact} />);
    expect(easeTo).toHaveBeenCalledTimes(1);
    const { center, offset } = easeTo.mock.calls[0][0];
    expect(center).toEqual([station.lon, station.lat]);
    if (compact) {
      expect(offset ?? [0, 0]).toEqual([0, 0]);
    } else {
      // Desktop: the dot sits below centre so the dot plus the popup above it are centred together.
      expect(offset[0]).toBe(0);
      expect(offset[1]).toBeGreaterThan(0);
    }
  });

  describe('overlay layers', () => {
    it('adds the route, endpoints and boundary below/above the stations layer', () => {
      renderMap();
      act(() => fireLoad());
      const added = addLayer.mock.calls.map(([layer, beforeId]) => [layer.id, beforeId]);
      const ids = added.map(([id]) => id);
      expect(ids).toEqual(expect.arrayContaining(['stations', 'route-walk', 'route-bike', 'endpoints', 'boundary']));
      expect(ids.indexOf('stations')).toBeLessThan(ids.indexOf('route-walk'));
      expect(added.find(([id]) => id === 'route-walk')![1]).toBe('stations');
      expect(added.find(([id]) => id === 'route-bike')![1]).toBe('stations');
      expect(added.find(([id]) => id === 'endpoints')![1]).toBeUndefined();
    });

    it('adds each overlay only once', () => {
      const { rerender } = renderMap();
      act(() => fireLoad());
      rerender(<StationMap {...BASE_PROPS} meta={{ ...META }} />); // same data, new object: the add effect runs again
      const ids = addLayer.mock.calls.map(([layer]) => layer.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('shows the boundary only while showBoundary is set', () => {
      const { rerender } = renderMap({ showBoundary: false });
      act(() => fireLoad());
      expect(setLayoutProperty).toHaveBeenLastCalledWith('boundary', 'visibility', 'none');
      rerender(<StationMap {...BASE_PROPS} showBoundary />);
      expect(setLayoutProperty).toHaveBeenLastCalledWith('boundary', 'visibility', 'visible');
      rerender(<StationMap {...BASE_PROPS} showBoundary={false} />);
      expect(setLayoutProperty).toHaveBeenLastCalledWith('boundary', 'visibility', 'none');
    });

    it('draws the from and to points with their roles', () => {
      const from = { lon: 14.5, lat: 46.04 };
      const to = { lon: 14.51, lat: 46.06 };
      const { rerender } = renderMap();
      act(() => fireLoad());
      rerender(<StationMap {...BASE_PROPS} endpoints={{ from, to: null }} />);
      const last = () => setDataCalls.filter((c) => c.source === 'endpoints').at(-1)!.data as FeatureCollection;
      expect(last().features.map((f) => [f.properties, f.geometry])).toEqual([
        [{ role: 'from' }, { type: 'Point', coordinates: [14.5, 46.04] }],
      ]);
      rerender(<StationMap {...BASE_PROPS} endpoints={{ from, to }} />);
      expect(last().features.map((f) => f.properties?.role)).toEqual(['from', 'to']);
    });
  });

  describe('trip overlay', () => {
    it('sets one route line per leg, tagged walk or bike, and fits the map to the whole route', () => {
      renderMap({ trip: bikeTrip(0.9, 0.8) });
      act(() => fireLoad());
      expect(routeData().features.map((f) => [f.properties?.leg, f.geometry])).toEqual([
        ['walk', WALK_1.geometry],
        ['bike', RIDE.geometry],
        ['walk', WALK_2.geometry],
      ]);
      expect(fitBounds).toHaveBeenCalledTimes(2); // the stations' initial fit, then the route
      const [bounds, options] = fitBounds.mock.lastCall!;
      expect(bounds.points).toEqual([...WALK_1.geometry.coordinates, ...RIDE.geometry.coordinates, ...WALK_2.geometry.coordinates]);
      expect(options).toMatchObject({ padding: { top: 60, right: 60, bottom: 60, left: 60 } });
    });

    it('keeps the route clear of the UI over the map, using the padding it is given', () => {
      const fitPadding = { top: 244, right: 40, bottom: 40, left: 40 };
      renderMap({ trip: bikeTrip(0.9, 0.8), fitPadding });
      act(() => fireLoad());
      expect(fitBounds.mock.lastCall![1]).toMatchObject({ padding: fitPadding });
    });

    it('does not refit when only the padding changes', () => {
      const trip = bikeTrip(0.9, 0.8);
      const { rerender } = renderMap({ trip });
      act(() => fireLoad());
      fitBounds.mockClear();
      rerender(<StationMap {...BASE_PROPS} trip={trip} fitPadding={{ top: 1, right: 2, bottom: 3, left: 4 }} />);
      expect(fitBounds).not.toHaveBeenCalled();
    });

    it('draws a walk-only trip as one walk line', () => {
      renderMap({ trip: WALK_TRIP });
      act(() => fireLoad());
      expect(routeData().features.map((f) => f.properties?.leg)).toEqual(['walk']);
      expect(fitBounds).toHaveBeenCalledTimes(2);
    });

    it('fades every station, and shows pickup and drop-off by their chance as selected', () => {
      renderMap({ trip: bikeTrip(0.9, null) });
      act(() => fireLoad());
      // Station 2 is the pickup: a 90 % chance of success is a 0.1 chance of the bad outcome, which is what `p` colours by.
      // Station 1 is the drop-off: no chance known, so grey.
      expect(lastStateOf('2')).toEqual({ p: expect.closeTo(0.1, 10), faded: false, selected: true });
      expect(lastStateOf('1')).toEqual({ p: -1, faded: false, selected: true });
    });

    it('fades the other stations and keeps their profile colour', () => {
      const meta = { ...META, stations: [...META.stations, { id: '3', name: 'OTHER', lat: 46.04, lon: 14.5, capacity: 10 }] };
      const profile = makeProfile('mon', { stations: { '3': stationSeries({ p_empty: series(0.4) }) } });
      renderMap({ meta, profile, trip: bikeTrip(0.9, 0.8) });
      act(() => fireLoad());
      expect(lastStateOf('3')).toEqual({ p: 0.4, faded: true });
    });

    it('fades every station for a walk trip', () => {
      renderMap({ trip: WALK_TRIP });
      act(() => fireLoad());
      expect(lastStateOf('1')).toMatchObject({ faded: true });
      expect(lastStateOf('2')).toMatchObject({ faded: true });
      expect(lastStateOf('1')).not.toHaveProperty('selected');
    });

    it('keeps the trip colours when the profile, slot or mode changes', () => {
      const trip = bikeTrip(0.9, 0.8);
      const profile = makeProfile('mon');
      const { rerender } = renderMap({ trip, profile });
      act(() => fireLoad());
      setFeatureState.mockClear();
      rerender(<StationMap {...BASE_PROPS} trip={trip} profile={profile} slot={7} mode="docks" />);
      expect(lastStateOf('2')).toEqual({ p: expect.closeTo(0.1, 10), faded: false, selected: true });
      expect(lastStateOf('1')).toEqual({ p: expect.closeTo(0.2, 10), faded: false, selected: true });
    });

    it('does not refit the map when only the colours change', () => {
      const trip = bikeTrip(0.9, 0.8);
      const { rerender } = renderMap({ trip });
      act(() => fireLoad());
      fitBounds.mockClear();
      rerender(<StationMap {...BASE_PROPS} trip={trip} slot={7} />);
      expect(fitBounds).not.toHaveBeenCalled();
    });

    it('refits when a new result replaces the old one', () => {
      const { rerender } = renderMap({ trip: bikeTrip(0.9, 0.8) });
      act(() => fireLoad());
      fitBounds.mockClear();
      rerender(<StationMap {...BASE_PROPS} trip={WALK_TRIP} />);
      expect(fitBounds).toHaveBeenCalledTimes(1);
    });

    it('restores every station and empties the route when the trip is cleared', () => {
      const profile = makeProfile('mon');
      const { rerender } = renderMap({ trip: bikeTrip(0.9, 0.8), profile });
      act(() => fireLoad());
      fitBounds.mockClear();
      rerender(<StationMap {...BASE_PROPS} trip={null} profile={profile} />);
      for (const id of ['1', '2']) expect(lastStateOf(id)).toEqual({ p: 0.05, faded: false, selected: false });
      expect(routeData().features).toEqual([]);
      expect(fitBounds).not.toHaveBeenCalled();
    });

    it('keeps the outline of the selected station when its trip highlight goes away', () => {
      const { rerender } = renderMap({ trip: bikeTrip(0.9, 0.8), selectedId: '2' });
      act(() => fireLoad());
      rerender(<StationMap {...BASE_PROPS} trip={null} selectedId="2" />);
      expect(lastStateOf('2')).toMatchObject({ selected: true });
      expect(lastStateOf('1')).toMatchObject({ selected: false });
    });

    it('treats a no-station result as no trip', () => {
      renderMap({ trip: { kind: 'no-station', end: 'start' } });
      act(() => fireLoad());
      expect(lastStateOf('1')).toEqual({ p: -1, faded: false });
      expect(routeData().features).toEqual([]);
      expect(fitBounds).toHaveBeenCalledTimes(1);
    });
  });

  describe('clicks', () => {
    const click = (lngLat = { lng: 14.5, lat: 46.05 }) => act(() => fireClick({ lngLat, point: { x: 1, y: 2 } }));

    it('picks the clicked point instead of selecting when onPick is set', () => {
      const onPick = vi.fn();
      const onSelect = vi.fn();
      queryRenderedFeatures.mockReturnValue([{ properties: { id: '1' } }]);
      renderMap({ onPick, onSelect });
      act(() => fireLoad());
      click({ lng: 14.5, lat: 46.05 });
      expect(onPick).toHaveBeenCalledExactlyOnceWith({ lon: 14.5, lat: 46.05 });
      expect(onSelect).not.toHaveBeenCalled();
    });

    it.each([
      ['bike', bikeTrip(0.9, 0.8)],
      ['walk', WALK_TRIP],
    ])('ignores clicks while a %s trip is shown', (_, trip) => {
      const onSelect = vi.fn();
      queryRenderedFeatures.mockReturnValue([{ properties: { id: '1' } }]);
      renderMap({ trip, onSelect });
      act(() => fireLoad());
      click();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('still picks while a trip is shown', () => {
      const onPick = vi.fn();
      renderMap({ trip: bikeTrip(0.9, 0.8), onPick });
      act(() => fireLoad());
      click();
      expect(onPick).toHaveBeenCalledOnce();
    });

    it('selects the clicked station, or nothing, when there is no trip and no onPick', () => {
      const onSelect = vi.fn();
      renderMap({ onSelect });
      act(() => fireLoad());
      queryRenderedFeatures.mockReturnValue([{ properties: { id: '2' } }]);
      click();
      expect(onSelect).toHaveBeenLastCalledWith('2');
      queryRenderedFeatures.mockReturnValue([]);
      click();
      expect(onSelect).toHaveBeenLastCalledWith(null);
    });

    it('reads the latest onPick and trip without recreating the map', () => {
      const onPick = vi.fn();
      const onSelect = vi.fn();
      const { rerender } = renderMap({ onSelect });
      act(() => fireLoad());
      rerender(<StationMap {...BASE_PROPS} onSelect={onSelect} onPick={onPick} />);
      click();
      expect(onPick).toHaveBeenCalledOnce();
      rerender(<StationMap {...BASE_PROPS} onSelect={onSelect} onPick={null} trip={WALK_TRIP} />);
      click();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
