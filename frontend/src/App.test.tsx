import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { StationMapProps } from './map/StationMap';
import { clearLegCache } from './trip/directions';
import { clearSearchCache } from './trip/search';
import { BASE_URL, FAIL, allRoutes, makeProfile, mockFetch, type Routes } from './test/fixtures';
import { setViewport } from './test/viewport';

// mapbox-gl needs WebGL; the stub renders one button per station and the desktop popup content.
vi.mock('./map/StationMap', () => ({
  StationMap: ({
    meta,
    onSelect,
    popup,
    trip,
    onPick,
    fitPadding,
    endpoints,
    onMoveEndpoint,
    onEndpointClick,
  }: StationMapProps) => (
    <div data-testid="map" data-fit-padding={JSON.stringify(fitPadding)}>
      <span data-testid="trip-kind">{trip?.kind ?? 'none'}</span>
      <span data-testid="start-at">{endpoints.from ? `${endpoints.from.lon},${endpoints.from.lat}` : 'none'}</span>
      {endpoints.from && (
        <>
          <button type="button" onClick={(e) => (e.currentTarget.dataset.accepted = String(onMoveEndpoint?.('from', { lon: 14.51, lat: 46.05 })))}>
            drag start inside
          </button>
          <button type="button" onClick={(e) => (e.currentTarget.dataset.accepted = String(onMoveEndpoint?.('from', { lon: 14.3556, lat: 46.2389 })))}>
            drag start outside
          </button>
          <button type="button" onClick={() => onEndpointClick?.('from')}>
            click start pin
          </button>
        </>
      )}
      {onPick && (
        <>
          <button type="button" onClick={() => onPick({ lon: 14.5058, lat: 46.0569 })}>
            pick inside
          </button>
          <button type="button" onClick={() => onPick({ lon: 14.3556, lat: 46.2389 })}>
            pick outside
          </button>
        </>
      )}
      {meta?.stations.map((s) => (
        <button key={s.id} type="button" onClick={() => onSelect(s.id)}>
          {`select station ${s.id}`}
        </button>
      ))}
      {popup}
    </div>
  ),
}));

// Monday 2 Nov 2026, 11:00 in Ljubljana: the trip card starts at 11:00 on the Monday profile.
const NOW = new Date('2026-11-02T10:00:00Z');

const lineRoute = (duration: number) => ({
  routes: [
    {
      duration,
      distance: duration * 1.2,
      geometry: { type: 'LineString', coordinates: [[14.5, 46.05], [14.51, 46.06]] },
    },
  ],
});

function tripRoutes(): Routes {
  return { ...allRoutes(), 'directions/walking': lineRoute(780), 'directions/cycling': lineRoute(120) };
}

function renderApp(routes: Routes = tripRoutes()) {
  const fetchFn = mockFetch(routes);
  render(<App baseUrl={BASE_URL} mapboxToken="pk.test" initialDay="mon" initialSlot={36} now={NOW} />);
  return fetchFn;
}

beforeEach(() => {
  clearLegCache();
  clearSearchCache();
});

const panel = () => screen.getByRole('region', { name: 'Typical availability' });
const waitReady = () => waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

describe('App', () => {
  it('opens at the given day and time and loads data', async () => {
    renderApp();
    expect(screen.getByText('Monday, 9:00 AM')).toBeInTheDocument();
    await waitReady();
    expect(screen.getByRole('button', { name: 'select station 1' })).toBeInTheDocument();
  });

  it('a day chip changes the label', async () => {
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(screen.getByText('Wednesday, 9:00 AM')).toBeInTheDocument();
  });

  it('shows Limited data for a thin profile only', async () => {
    const routes = allRoutes();
    routes['wed.json'] = makeProfile('wed', { days_used: 1.2 });
    renderApp(routes);
    await waitReady();
    expect(screen.queryByText('Limited data')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(await screen.findByText('Limited data')).toBeInTheDocument();
  });

  it('the slider updates the label', async () => {
    renderApp();
    await waitReady();
    fireEvent.change(screen.getByRole('slider', { name: 'Time of day' }), { target: { value: '37' } });
    expect(screen.getByText('Monday, 9:15 AM')).toBeInTheDocument();
  });

  it('the mode toggle swaps the legend word and the detail sentence', async () => {
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
    expect(screen.getByText(/Typically/)).toHaveTextContent('chance empty');
    expect(within(panel()).getByText('Empty')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Docks' }));
    expect(screen.getByText(/Typically/)).toHaveTextContent('chance full');
    expect(within(panel()).getByText('Full')).toBeInTheDocument();
  });

  it('clicking a chart bar moves the slider', async () => {
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
    await userEvent.click(screen.getByRole('button', { name: /^8:00 PM:/ }));
    expect(screen.getByText('Monday, 8:00 PM')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Time of day' })).toHaveValue('80');
  });

  it('on mobile the station opens in a bottom sheet with a half-hourly chart', async () => {
    setViewport('mobile');
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
    const sheet = screen.getByRole('dialog', { name: 'Station details' });
    expect(within(sheet).getAllByRole('button').filter((b) => b.classList.contains('bar-hit'))).toHaveLength(48);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a failed load shows Retry, and Retry loads again', async () => {
    const routes = allRoutes();
    routes['mon.json'] = FAIL;
    renderApp(routes);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load data.");
    routes['mon.json'] = makeProfile('mon');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitReady();
  });

  describe('trip planner', () => {
    const tripKind = () => screen.getByTestId('trip-kind');

    async function chooseOnMap(field: 'From' | 'To') {
      await userEvent.click(screen.getByRole('textbox', { name: field }));
      await userEvent.click(screen.getByRole('option', { name: 'Choose on map' }));
    }

    /** From = a point inside Ljubljana picked on the map, To = the Kongresni station. */
    async function planTrip() {
      await userEvent.click(screen.getByRole('button', { name: 'Where to?' }));
      await chooseOnMap('From');
      await userEvent.click(screen.getByRole('button', { name: 'pick inside' }));
      await userEvent.type(screen.getByRole('textbox', { name: 'To' }), 'kongres');
      await userEvent.click(screen.getByRole('option', { name: /Kongresni/ }));
    }

    it('on mobile shows the Where to? pill and the availability panel', async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      expect(screen.getByRole('button', { name: 'Where to?' })).toBeVisible();
      expect(panel()).toBeVisible();
    });

    it('refuses a map pick outside Ljubljana and keeps picking', async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      await userEvent.click(screen.getByRole('button', { name: 'Where to?' }));
      await chooseOnMap('To');
      await userEvent.click(screen.getByRole('button', { name: 'pick outside' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Pick a point inside Ljubljana');
      expect(tripKind()).toHaveTextContent('none');
      expect(screen.getByRole('button', { name: 'pick inside' })).toBeInTheDocument();
    });

    describe('start and destination pins', () => {
      const startAt = () => screen.getByTestId('start-at');

      it('moves the start to where its pin is dragged', async () => {
        setViewport('mobile');
        renderApp();
        await waitReady();
        await planTrip();
        expect(startAt()).toHaveTextContent('14.5058,46.0569');
        const drag = screen.getByRole('button', { name: 'drag start inside' });
        await userEvent.click(drag);
        expect(drag.dataset.accepted).toBe('true');
        expect(startAt()).toHaveTextContent('14.51,46.05');
        expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('Point on map');
      });

      it('refuses a pin dragged outside Ljubljana and keeps the old start', async () => {
        setViewport('mobile');
        renderApp();
        await waitReady();
        await planTrip();
        const drag = screen.getByRole('button', { name: 'drag start outside' });
        await userEvent.click(drag);
        expect(drag.dataset.accepted).toBe('false');
        expect(screen.getByRole('alert')).toHaveTextContent('Pick a point inside Ljubljana');
        expect(startAt()).toHaveTextContent('14.5058,46.0569');
      });

      it('clicking a pin moves it with the next map click; clicking it again cancels', async () => {
        setViewport('mobile');
        renderApp();
        await waitReady();
        await planTrip();
        const pin = screen.getByRole('button', { name: 'click start pin' });
        await userEvent.click(pin);
        expect(screen.getByRole('status')).toHaveTextContent('Tap the map to set the start');
        await userEvent.click(pin);
        expect(screen.queryByText('Tap the map to set the start')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'pick inside' })).not.toBeInTheDocument();

        await userEvent.click(pin);
        await userEvent.click(screen.getByRole('button', { name: 'drag start inside' })); // move it away first
        await userEvent.click(pin);
        await userEvent.click(screen.getByRole('button', { name: 'pick inside' }));
        expect(startAt()).toHaveTextContent('14.5058,46.0569');
        expect(screen.queryByText('Tap the map to set the start')).not.toBeInTheDocument();
      });
    });

    it('plans a trip, turns the availability panel into the trip day and time picker, and shows the result', async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      await planTrip();
      await waitFor(() => expect(tripKind()).not.toHaveTextContent('none'));
      expect(screen.queryByRole('region', { name: 'Typical availability' })).not.toBeInTheDocument();
      const picker = screen.getByRole('region', { name: 'Trip day and time' });
      expect(within(picker).getByText('Leave at Monday, 9:00 AM')).toBeInTheDocument(); // renderApp's slot 36
      expect(within(picker).getByRole('slider', { name: 'Time of day' })).toBeInTheDocument();
      expect(within(picker).queryByRole('button', { name: 'Docks' })).not.toBeInTheDocument();
      expect(await screen.findByText('Walking is faster')).toBeInTheDocument();
    });

    it("the trip follows the picker's day and time, and its Leave at / Arrive by", async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      await planTrip();
      expect(await screen.findByText(/^Today · 9:00 AM/)).toBeInTheDocument();
      const picker = () => screen.getByRole('region', { name: 'Trip day and time' });

      fireEvent.change(within(picker()).getByRole('slider', { name: 'Time of day' }), { target: { value: '72' } });
      expect(within(picker()).getByText('Leave at Monday, 6:00 PM')).toBeInTheDocument();
      expect(await screen.findByText(/^Today · 6:00 PM/)).toBeInTheDocument();
      expect(screen.queryByText('This time has already passed.')).not.toBeInTheDocument();

      await userEvent.click(within(picker()).getByRole('button', { name: 'Wednesday' }));
      expect(within(picker()).getByText('Leave at Wednesday, 6:00 PM')).toBeInTheDocument();
      expect(await screen.findByText(/^Wed 4 Nov · 6:00 PM/)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Arrive by' }));
      expect(within(picker()).getByText('Arrive by Wednesday, 6:00 PM')).toBeInTheDocument();

      fireEvent.change(within(picker()).getByRole('slider', { name: 'Time of day' }), { target: { value: '4' } });
      await userEvent.click(within(picker()).getByRole('button', { name: 'Monday' }));
      expect(await screen.findByText('This time has already passed.')).toBeInTheDocument();
    });

    it('Close trip brings the availability panel back', async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      await planTrip();
      await waitFor(() => expect(tripKind()).not.toHaveTextContent('none'));
      await userEvent.click(screen.getByRole('button', { name: 'Close trip' }));
      expect(panel()).toBeInTheDocument();
      expect(tripKind()).toHaveTextContent('none');
      expect(screen.getByRole('button', { name: 'Where to?' })).toBeInTheDocument();
    });

    it('a trip whose data failed to load shows Retry, and Retry plans the trip', async () => {
      setViewport('mobile');
      const routes = tripRoutes();
      routes['sun.json'] = FAIL;
      renderApp(routes);
      await waitReady();
      await planTrip();
      expect(await screen.findByText("Couldn't load data.")).toBeInTheDocument();
      routes['sun.json'] = makeProfile('sun');
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('Walking is faster')).toBeInTheDocument();
    });

    describe('a tab left open past midnight', () => {
      // 00:30 on Tue 3 Nov in Ljubljana; the page was loaded on Mon 2 Nov.
      const AFTER_MIDNIGHT = new Date('2026-11-02T23:30:00Z');

      afterEach(() => vi.useRealTimers());

      /** A trip on the picker's start, Monday 9:00 (renderApp's slot 36), which is today until midnight. */
      async function planForToday() {
        setViewport('mobile');
        renderApp();
        await waitReady();
        await planTrip();
        expect(await screen.findByText(/^Today · 9:00 AM/)).toBeInTheDocument();
      }

      it('moves Monday on to next week when the tab becomes visible again', async () => {
        await planForToday();
        vi.useFakeTimers({ toFake: ['Date'], now: AFTER_MIDNIGHT });
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(await screen.findByText(/^Mon 9 Nov · 9:00 AM/)).toBeInTheDocument();
      });

      it('also moves on at window focus', async () => {
        await planForToday();
        vi.useFakeTimers({ toFake: ['Date'], now: AFTER_MIDNIGHT });
        act(() => {
          window.dispatchEvent(new Event('focus'));
        });
        expect(await screen.findByText(/^Mon 9 Nov · 9:00 AM/)).toBeInTheDocument();
      });

      it('refreshes every minute', async () => {
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
        await planForToday();
        vi.setSystemTime(AFTER_MIDNIGHT);
        act(() => {
          vi.advanceTimersByTime(60_000);
        });
        expect(await screen.findByText(/^Mon 9 Nov · 9:00 AM/)).toBeInTheDocument();
      });
    });

    it('clears a selected station when planning starts, so closing the trip does not bring its sheet back', async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
      expect(screen.getByRole('dialog', { name: 'Station details' })).toBeInTheDocument();
      await planTrip();
      expect(screen.getByText('Planning…')).toBeInTheDocument(); // closed before any result arrives
      await userEvent.click(screen.getByRole('button', { name: 'Close trip' }));
      expect(screen.queryByRole('dialog', { name: 'Station details' })).not.toBeInTheDocument();
    });

    it('clears a station selected during planning when the trip is closed', async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      await planTrip();
      await waitFor(() => expect(tripKind()).not.toHaveTextContent('none'));
      await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
      await userEvent.click(screen.getByRole('button', { name: 'Close trip' }));
      expect(screen.queryByRole('dialog', { name: 'Station details' })).not.toBeInTheDocument();
    });

    it('gives a repeated notice its full time on screen again', async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      await userEvent.click(screen.getByRole('button', { name: 'Where to?' }));
      await chooseOnMap('To');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const outside = screen.getByRole('button', { name: 'pick outside' });
        fireEvent.click(outside);
        act(() => vi.advanceTimersByTime(2000));
        fireEvent.click(outside); // the same text again
        act(() => vi.advanceTimersByTime(2000)); // 4 s after the first, 2 s after the second
        expect(screen.getByRole('alert')).toHaveTextContent('Pick a point inside Ljubljana');
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    describe('fit padding', () => {
      const fitPadding = () => JSON.parse(screen.getByTestId('map').dataset.fitPadding!);

      it('on desktop clears the side column', async () => {
        renderApp();
        await waitReady();
        expect(fitPadding()).toEqual({ top: 60, right: 60, bottom: 60, left: 492 });
      });

      it('on mobile clears the top trip card once it is measured, and assumes a height until then', async () => {
        const callbacks: ResizeObserverCallback[] = [];
        vi.stubGlobal(
          'ResizeObserver',
          class {
            constructor(callback: ResizeObserverCallback) {
              callbacks.push(callback);
            }
            observe() {}
            disconnect() {}
          },
        );
        setViewport('mobile');
        renderApp();
        await waitReady();
        expect(fitPadding()).toEqual({ top: 244, right: 40, bottom: 40, left: 40 });
        act(() => callbacks.forEach((cb) => cb([{ contentRect: { height: 150.4 } } as ResizeObserverEntry], {} as ResizeObserver)));
        expect(fitPadding()).toEqual({ top: 175, right: 40, bottom: 40, left: 40 });
      });
    });

    it('on desktop the result sits below the day and time picker, so re-planning never moves the picker', async () => {
      renderApp();
      await waitReady();
      await userEvent.type(screen.getByRole('textbox', { name: 'From' }), 'kongres');
      await userEvent.click(screen.getByRole('option', { name: /Kongresni/ }));
      await userEvent.click(screen.getByRole('textbox', { name: 'To' }));
      await userEvent.click(screen.getByRole('option', { name: 'Choose on map' }));
      await userEvent.click(screen.getByRole('button', { name: 'pick inside' }));
      const picker = screen.getByRole('region', { name: 'Trip day and time' });
      const result = screen.getByRole('region', { name: 'Trip result' });
      expect(within(result).getByText('Planning…')).toBeInTheDocument();
      expect(picker.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(screen.getByRole('region', { name: 'Trip planner' })).queryByText('Planning…')).not.toBeInTheDocument();
      expect(await within(result).findByText(/^Today · /)).toBeInTheDocument();
    });

    it('on desktop the trip card and the availability panel sit together, with no pill', async () => {
      renderApp();
      await waitReady();
      expect(screen.getByRole('region', { name: 'Trip planner' })).toBeVisible();
      expect(panel()).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Where to?' })).not.toBeInTheDocument();
    });
  });
});
