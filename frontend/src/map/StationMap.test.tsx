import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StationMap } from './StationMap';

const resize = vi.fn();

// mapbox-gl needs WebGL; only the calls this test cares about are real.
vi.mock('mapbox-gl', () => ({
  default: {
    Map: class {
      on() {}
      resize = resize;
      remove() {}
    },
  },
}));

describe('StationMap', () => {
  it('resizes the map when its container changes size, not only on window resize', () => {
    // The mobile bottom sheet grows and shrinks the map area without any window resize event.
    const observed: { callback: ResizeObserverCallback; target: Element }[] = [];
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
    const { container } = render(
      <StationMap token="pk.test" meta={null} profile={null} slot={0} mode="bikes" selectedId={null} onSelect={vi.fn()} popup={null} compact />,
    );
    const map = container.querySelector('.map')!;
    const watcher = observed.find((o) => o.target === map);
    expect(watcher).toBeDefined();
    watcher!.callback([], {} as ResizeObserver);
    expect(resize).toHaveBeenCalled();
  });
});
