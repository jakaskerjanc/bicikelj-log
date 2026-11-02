import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAIL, META, mockFetch } from '../test/fixtures';
import { clearSearchCache, searchPlaces } from './search';
import { TripSearch, type TripSearchProps } from './TripSearch';
import type { Place, TripInputs } from './types';

// Wraps the real searchPlaces so tests can read the AbortSignal the field passes to it.
vi.mock('./search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./search')>();
  return { ...actual, searchPlaces: vi.fn(actual.searchPlaces) };
});

/** A fetch that never answers, so a search stays in flight until it is aborted. */
const hangingFetch = () => vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

/** The AbortSignal of the n-th searchPlaces call. */
const searchSignal = (n: number): AbortSignal => {
  const signal = vi.mocked(searchPlaces).mock.calls[n][3];
  if (!signal) throw new Error('searchPlaces was called without a signal');
  return signal;
};

const NOW = new Date('2026-11-02T10:00:00Z');
const place = (name: string, lon = 14.5, lat = 46.05): Place => ({ name, detail: '', at: { lon, lat } });

const EMPTY: TripInputs = {
  from: null,
  to: null,
  timeMode: 'leave',
  date: '2026-11-02',
  time: '11:00',
  risk: 'safe',
};

const FORWARD = {
  features: [
    { properties: { name: 'Ljubljana Castle', place_formatted: 'Ljubljana' }, geometry: { coordinates: [14.5086, 46.0488] } },
  ],
};

function setup(overrides: Partial<TripSearchProps> = {}) {
  const props: TripSearchProps = {
    inputs: EMPTY,
    onInputs: vi.fn(),
    open: true,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    collapsible: false,
    pickTarget: null,
    onPickTarget: vi.fn(),
    stations: META.stations,
    token: 'tok',
    now: NOW,
    onNotice: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
  const { unmount } = render(<TripSearch {...props} />);
  return { props, user, unmount };
}

function stubGeolocation(lon: number, lat: number) {
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: { longitude: lon, latitude: lat } } as GeolocationPosition),
  );
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // Testing Library only waits fake-timer-aware when it sees a `jest` global.
  vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime.bind(vi) });
  clearSearchCache();
  vi.mocked(searchPlaces).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TripSearch', () => {
  it('collapsed shows only the Where to? pill, which opens the card', async () => {
    const { props, user } = setup({ collapsible: true, open: false });
    expect(screen.queryByRole('textbox', { name: 'From' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Where to?' }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('is always open when not collapsible', () => {
    setup({ collapsible: false, open: false });
    expect(screen.getByRole('textbox', { name: 'From' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Where to?' })).not.toBeInTheDocument();
  });

  it('close button calls onClose', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Close trip' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the chosen place name and renders children', () => {
    setup({ inputs: { ...EMPTY, to: place('Office') }, children: <p>Result here</p> });
    expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('Office');
    expect(screen.getByText('Result here')).toBeInTheDocument();
  });

  it('typing lists matching stations at once and clicking one sets the destination', async () => {
    const { props, user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'To' }), 'pres');
    const option = screen.getByRole('option', { name: /Prešernov Trg-Petkovškovo Nabrežje/ });
    await user.click(option);
    expect(props.onInputs).toHaveBeenCalledWith(
      expect.objectContaining({ to: expect.objectContaining({ name: 'Prešernov Trg-Petkovškovo Nabrežje' }) }),
    );
  });

  it('Enter on a focused option chooses it', async () => {
    const { props, user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'To' }), 'kongres');
    await user.keyboard('{ArrowDown}{ArrowDown}'); // past "Choose on map"
    expect(document.activeElement).toHaveAttribute('role', 'option');
    expect(document.activeElement).toHaveTextContent('Kongresni');
    await user.keyboard('{Enter}');
    expect(props.onInputs).toHaveBeenCalledWith(
      expect.objectContaining({ to: expect.objectContaining({ name: 'Kongresni Trg-Šubičeva Ulica' }) }),
    );
  });

  it('lists My location only for From, then Choose on map', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('textbox', { name: 'From' }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'My location',
      'Choose on map',
    ]);
    await user.click(screen.getByRole('textbox', { name: 'To' }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose on map',
    ]);
  });

  it('Choose on map starts picking for that field', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('textbox', { name: 'To' }));
    await user.click(screen.getByRole('option', { name: 'Choose on map' }));
    expect(props.onPickTarget).toHaveBeenCalledWith('to');
  });

  it('shows a hint while picking', () => {
    setup({ pickTarget: 'from' });
    expect(screen.getByText('Tap the map to set the start')).toBeInTheDocument();
  });

  it('hints at the destination when picking To, and nothing otherwise', () => {
    setup({ pickTarget: 'to' });
    expect(screen.getByText('Tap the map to set the destination')).toBeInTheDocument();
  });

  it('shows no hint when not picking', () => {
    setup();
    expect(screen.queryByText(/Tap the map/)).not.toBeInTheDocument();
  });

  it('searches once, after a 400 ms pause and from 3 characters', async () => {
    const fetchFn = mockFetch({ 'searchbox/forward': FORWARD });
    const { user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'To' }), 'ko');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'To' }), 'lodvor');
    await vi.advanceTimersByTimeAsync(399);
    expect(fetchFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain('searchbox/v1/forward');
    expect(await screen.findByRole('option', { name: /Ljubljana Castle/ })).toBeInTheDocument();
  });

  it('chooses a search result', async () => {
    mockFetch({ 'searchbox/forward': FORWARD });
    const { props, user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'To' }), 'grad');
    await vi.advanceTimersByTimeAsync(400);
    await user.click(await screen.findByRole('option', { name: /Ljubljana Castle/ }));
    expect(props.onInputs).toHaveBeenCalledWith(
      expect.objectContaining({ to: { name: 'Ljubljana Castle', detail: 'Ljubljana', at: { lon: 14.5086, lat: 46.0488 } } }),
    );
  });

  it('debounces: a keystroke inside the pause restarts the 400 ms wait', async () => {
    const fetchFn = mockFetch({ 'searchbox/forward': FORWARD });
    const { user } = setup();
    const to = screen.getByRole('textbox', { name: 'To' });
    await user.type(to, 'grad');
    await vi.advanceTimersByTimeAsync(300);
    await user.type(to, 'o');
    await vi.advanceTimersByTimeAsync(399);
    expect(fetchFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain('q=grado');
  });

  it('aborts the in-flight search when the query changes', async () => {
    hangingFetch();
    const { user } = setup();
    const to = screen.getByRole('textbox', { name: 'To' });
    await user.type(to, 'grad');
    await vi.advanceTimersByTimeAsync(400);
    expect(searchSignal(0).aborted).toBe(false);
    await user.type(to, 'x');
    expect(searchSignal(0).aborted).toBe(true);
  });

  it('aborts the in-flight search when the field unmounts', async () => {
    hangingFetch();
    const { user, unmount } = setup();
    await user.type(screen.getByRole('textbox', { name: 'To' }), 'grad');
    await vi.advanceTimersByTimeAsync(400);
    expect(searchSignal(0).aborted).toBe(false);
    unmount();
    expect(searchSignal(0).aborted).toBe(true);
  });

  it('says Search unavailable when the search fails', async () => {
    mockFetch({ 'searchbox/forward': FAIL });
    const { user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'To' }), 'kolodvor');
    await vi.advanceTimersByTimeAsync(400);
    expect(await screen.findByText('Search unavailable')).toBeInTheDocument();
  });

  it('does not report an aborted search as unavailable when the user returns to its query', async () => {
    hangingFetch();
    const { user } = setup();
    const to = screen.getByRole('textbox', { name: 'To' });
    await user.type(to, 'grad');
    await vi.advanceTimersByTimeAsync(400); // request in flight
    await user.type(to, 'x'); // supersedes (aborts) it
    await act(() => vi.advanceTimersByTimeAsync(0)); // let any rejection and its state update land
    await user.type(to, '{Backspace}'); // back to the aborted query
    await act(() => vi.advanceTimersByTimeAsync(0)); // let any rejection and its state update land
    expect(screen.queryByText('Search unavailable')).not.toBeInTheDocument();
  });

  it('rejects a chosen station outside Ljubljana with a notice', async () => {
    const kranj = { id: '9', name: 'KRANJ GLAVNI TRG', lat: 46.2389, lon: 14.3558, capacity: 10 };
    const { props, user } = setup({ stations: [kranj] });
    await user.type(screen.getByRole('textbox', { name: 'To' }), 'kranj');
    await user.click(screen.getByRole('option', { name: /Kranj Glavni Trg/ }));
    expect(props.onNotice).toHaveBeenCalledWith('Pick a point inside Ljubljana');
    expect(props.onInputs).not.toHaveBeenCalled();
  });

  it('My location inside Ljubljana sets From', async () => {
    stubGeolocation(14.5, 46.05);
    const { props, user } = setup();
    await user.click(screen.getByRole('textbox', { name: 'From' }));
    await user.click(screen.getByRole('option', { name: 'My location' }));
    expect(props.onInputs).toHaveBeenCalledWith(
      expect.objectContaining({ from: { name: 'My location', detail: '', at: { lon: 14.5, lat: 46.05 } } }),
    );
  });

  it('My location outside Ljubljana shows a notice and sets nothing', async () => {
    stubGeolocation(14.3558, 46.2389); // Kranj
    const { props, user } = setup();
    await user.click(screen.getByRole('textbox', { name: 'From' }));
    await user.click(screen.getByRole('option', { name: 'My location' }));
    expect(props.onNotice).toHaveBeenCalledWith('Pick a point inside Ljubljana');
    expect(props.onInputs).not.toHaveBeenCalled();
  });

  it('My location failure shows a notice', async () => {
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({} as GeolocationPositionError) },
    });
    const { props, user } = setup();
    await user.click(screen.getByRole('textbox', { name: 'From' }));
    await user.click(screen.getByRole('option', { name: 'My location' }));
    expect(props.onNotice).toHaveBeenCalledWith("Couldn't get your location");
    expect(props.onInputs).not.toHaveBeenCalled();
  });

  it('clearing the field clears the place', async () => {
    const { props, user } = setup({ inputs: { ...EMPTY, to: place('Office') } });
    await user.clear(screen.getByRole('textbox', { name: 'To' }));
    expect(props.onInputs).toHaveBeenCalledWith(expect.objectContaining({ to: null }));
  });

  it('Arrive by and Risky update the inputs and reflect the current state', async () => {
    const { props, user } = setup();
    expect(screen.getByRole('button', { name: 'Leave at' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Safe' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Arrive by' }));
    expect(props.onInputs).toHaveBeenLastCalledWith({ ...EMPTY, timeMode: 'arrive' });
    await user.click(screen.getByRole('button', { name: 'Risky' }));
    expect(props.onInputs).toHaveBeenLastCalledWith({ ...EMPTY, risk: 'risky' });
  });

  it('time and date inputs update the inputs', async () => {
    const { props } = setup();
    const time = screen.getByLabelText('Time');
    expect(time).toHaveAttribute('type', 'time');
    expect(time).toHaveValue('11:00');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) }).selectOptions(screen.getByLabelText('Date'), '2026-11-04');
    expect(props.onInputs).toHaveBeenLastCalledWith({ ...EMPTY, date: '2026-11-04' });
  });

  it('offers today and the next seven days', () => {
    setup();
    const options = within(screen.getByLabelText('Date')).getAllByRole('option');
    expect(options).toHaveLength(8);
    expect(options[0]).toHaveTextContent('Today');
    expect(options[1]).toHaveTextContent('Tomorrow');
    expect(options[2]).toHaveTextContent('Wed 4 Nov');
  });

  it('Swap exchanges From and To', async () => {
    const from = place('A');
    const to = place('B');
    const { props, user } = setup({ inputs: { ...EMPTY, from, to } });
    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(props.onInputs).toHaveBeenCalledWith({ ...EMPTY, from: to, to: from });
  });
});
