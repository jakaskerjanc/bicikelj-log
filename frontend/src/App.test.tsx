import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { StationMapProps } from './map/StationMap';
import { BASE_URL, FAIL, allRoutes, makeProfile, mockFetch, type Routes } from './test/fixtures';
import { setViewport } from './test/viewport';

// mapbox-gl needs WebGL; the stub renders one button per station and the desktop popup content.
vi.mock('./map/StationMap', () => ({
  StationMap: ({ meta, onSelect, popup }: StationMapProps) => (
    <div data-testid="map">
      {meta?.stations.map((s) => (
        <button key={s.id} type="button" onClick={() => onSelect(s.id)}>
          {`select station ${s.id}`}
        </button>
      ))}
      {popup}
    </div>
  ),
}));

function renderApp(routes: Routes = allRoutes()) {
  const fetchFn = mockFetch(routes);
  render(<App baseUrl={BASE_URL} mapboxToken="pk.test" initialDay="mon" initialSlot={36} />);
  return fetchFn;
}

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

  it('on mobile the station opens in a bottom sheet with an hourly chart', async () => {
    setViewport('mobile');
    renderApp();
    await waitReady();
    await userEvent.click(screen.getByRole('button', { name: 'select station 1' }));
    const sheet = screen.getByRole('dialog', { name: 'Station details' });
    expect(within(sheet).getAllByRole('button').filter((b) => b.classList.contains('bar-hit'))).toHaveLength(24);
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
});
