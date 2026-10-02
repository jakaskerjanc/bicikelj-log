import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { META } from '../test/fixtures';
import { StationMap, type StationMapProps } from './StationMap';

const resize = vi.fn();
const easeTo = vi.fn();
let fireLoad = () => {};

// mapbox-gl needs WebGL; this stand-in only keeps the state StationMap reads back.
vi.mock('mapbox-gl', () => {
  class Map {
    private sources = new Set<string>();
    resize = resize;
    easeTo = easeTo;
    on(event: string, handler: () => void) {
      if (event === 'load') fireLoad = handler;
    }
    addSource(id: string) {
      this.sources.add(id);
    }
    getSource(id: string) {
      return this.sources.has(id) ? {} : undefined;
    }
    addLayer() {}
    getLayer() {}
    fitBounds() {}
    setFeatureState() {}
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
    extend() {}
  }
  return { default: { Map, Popup, LngLatBounds } };
});

const observed: { callback: ResizeObserverCallback; target: Element }[] = [];

beforeEach(() => {
  resize.mockClear();
  easeTo.mockClear();
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

function renderMap(props: Partial<StationMapProps> = {}) {
  return render(
    <StationMap token="pk.test" meta={META} profile={null} slot={0} mode="bikes" selectedId={null} onSelect={vi.fn()} popup={null} compact {...props} />,
  );
}

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
    rerender(
      <StationMap token="pk.test" meta={META} profile={null} slot={0} mode="bikes" selectedId={station.id} onSelect={vi.fn()} popup={null} compact={compact} />,
    );
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
});
