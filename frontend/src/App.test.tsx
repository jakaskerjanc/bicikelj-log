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
  StationMap: ({ meta, onSelect, popup, trip, onPick }: StationMapProps) => (
    <div data-testid="map">
      <span data-testid="trip-kind">{trip?.kind ?? 'none'}</span>
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

    it('plans a trip, hides the availability panel and shows the result', async () => {
      setViewport('mobile');
      renderApp();
      await waitReady();
      await planTrip();
      await waitFor(() => expect(tripKind()).not.toHaveTextContent('none'));
      expect(screen.queryByRole('region', { name: 'Typical availability' })).not.toBeInTheDocument();
      expect(await screen.findByText('Walking is faster')).toBeInTheDocument();
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
      const dateOptions = () => within(screen.getByLabelText('Date')).getAllByRole('option');

      afterEach(() => vi.useRealTimers());

      it('moves Today on when the tab becomes visible again, keeping the chosen date', async () => {
        renderApp();
        await waitReady();
        expect(dateOptions()[0]).toHaveTextContent('Today');
        expect(dateOptions()[0]).toHaveValue('2026-11-02');
        vi.useFakeTimers({ toFake: ['Date'], now: AFTER_MIDNIGHT });
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(screen.getByRole('option', { name: 'Today' })).toHaveValue('2026-11-03');
        // The date picked before midnight is now yesterday, and stays selected and listed.
        expect(screen.getByLabelText('Date')).toHaveValue('2026-11-02');
        expect(dateOptions()[0]).toHaveValue('2026-11-02');
      });

      it('also moves on at window focus', async () => {
        renderApp();
        await waitReady();
        vi.useFakeTimers({ toFake: ['Date'], now: AFTER_MIDNIGHT });
        act(() => {
          window.dispatchEvent(new Event('focus'));
        });
        expect(screen.getByRole('option', { name: 'Today' })).toHaveValue('2026-11-03');
      });

      it('refreshes every minute', () => {
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
        renderApp();
        vi.setSystemTime(AFTER_MIDNIGHT);
        act(() => {
          vi.advanceTimersByTime(60_000);
        });
        expect(screen.getByRole('option', { name: 'Today' })).toHaveValue('2026-11-03');
      });
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
