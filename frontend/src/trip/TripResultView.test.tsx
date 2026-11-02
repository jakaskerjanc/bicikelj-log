import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { colorFor } from '../data/colors';
import { META } from '../test/fixtures';
import type { Leg, Place, StationOdds, TripInputs, TripResult } from './types';
import { TripResultView } from './TripResultView';
import type { TripState } from './useTrip';

const place = (name: string): Place => ({ name, detail: '', at: { lon: 14.5, lat: 46.05 } });

const INPUTS: TripInputs = {
  from: place('Home'),
  to: place('Office'),
  timeMode: 'leave',
  date: '2026-11-03',
  time: '05:08',
  risk: 'safe',
};

const leg = (mode: Leg['mode'], durationS: number): Leg => ({
  mode,
  durationS,
  distanceM: 100,
  geometry: { type: 'LineString', coordinates: [] },
});

const odds = (index: number, chance: number | null, acceptable = true): StationOdds => ({
  station: META.stations[index],
  chance,
  acceptable,
});

// 05:08 and 05:30 in Ljubljana (UTC+1 in November).
const DEPART = new Date('2026-11-03T04:08:00Z');
const ARRIVE = new Date('2026-11-03T04:30:00Z');

function bike(overrides: Partial<Extract<TripResult, { kind: 'bike' }>> = {}): TripResult {
  return {
    kind: 'bike',
    depart: DEPART,
    arrive: ARRIVE,
    legs: [leg('walk', 300), leg('bike', 600), leg('walk', 300)],
    pickup: odds(0, 0.95),
    dropoff: odds(1, 0.4, false),
    limitedData: false,
    ...overrides,
  };
}

// The day before the trip, so nothing is in the past.
const NOW = new Date('2026-11-02T10:00:00Z');

const ready = (result: TripResult): TripState => ({ status: 'ready', result });

describe('TripResultView', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<TripResultView state={{ status: 'idle' }} inputs={INPUTS} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a planning message while loading', () => {
    render(<TripResultView state={{ status: 'loading' }} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('Planning…')).toBeInTheDocument();
  });

  it('shows the error with a working Retry button', async () => {
    const retry = vi.fn();
    render(<TripResultView state={{ status: 'error', retry }} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText("Couldn't get the route.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('says which end has no station nearby', () => {
    const { rerender } = render(<TripResultView state={ready({ kind: 'no-station', end: 'start' })} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('No station within 1 km of the start')).toBeInTheDocument();
    rerender(<TripResultView state={ready({ kind: 'no-station', end: 'end' })} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('No station within 1 km of the end')).toBeInTheDocument();
  });

  it('walk result says walking is faster and has one row', () => {
    const walk: TripResult = { kind: 'walk', depart: DEPART, arrive: ARRIVE, legs: [leg('walk', 1320)] };
    render(<TripResultView state={ready(walk)} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('Walking is faster')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow · 5:08 AM → 5:30 AM')).toBeInTheDocument();
    expect(screen.getByText('22 min')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Walk 22 min to Office')).toBeInTheDocument();
  });

  it('bike result shows the header, three rows and title-cased station names', () => {
    render(<TripResultView state={ready(bike())} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('Tomorrow · 5:08 AM → 5:30 AM')).toBeInTheDocument();
    expect(screen.getByText('22 min')).toBeInTheDocument();
    expect(screen.getByText('Walk 5 min to Prešernov Trg-Petkovškovo Nabrežje')).toBeInTheDocument();
    expect(screen.getByText('Ride 10 min to Kongresni Trg-Šubičeva Ulica')).toBeInTheDocument();
    expect(screen.getByText('Walk 5 min to Office')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('never shows less than one minute and rounds to the nearest', () => {
    const result = bike({ legs: [leg('walk', 10), leg('bike', 89), leg('walk', 91)] });
    render(<TripResultView state={ready(result)} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText(/^Walk 1 min to Prešernov/)).toBeInTheDocument();
    expect(screen.getByText(/^Ride 1 min to Kongresni/)).toBeInTheDocument();
    expect(screen.getByText('Walk 2 min to Office')).toBeInTheDocument();
  });

  it('labels the chances and flags the unacceptable station', () => {
    render(<TripResultView state={ready(bike())} inputs={INPUTS} now={NOW} />);
    const bikeChance = screen.getByText('Bike likely · 9 in 10');
    expect(bikeChance).not.toHaveClass('warn');
    const dockChance = screen.getByText('Free dock unlikely · 4 in 10');
    expect(dockChance).toHaveClass('warn');
  });

  it('words the chance by threshold and clamps the count to 1..9', () => {
    const result = bike({ pickup: odds(0, 0.6), dropoff: odds(1, 0.02, false) });
    render(<TripResultView state={ready(result)} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('Bike possible · 6 in 10')).toBeInTheDocument();
    expect(screen.getByText('Free dock unlikely · 1 in 10')).toBeInTheDocument();
  });

  it('copes with a missing chance', () => {
    render(<TripResultView state={ready(bike({ pickup: odds(0, null, false) }))} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('Bike chance unknown')).toHaveClass('warn');
  });

  it('shows the departure hint only for Arrive by', () => {
    const { rerender } = render(<TripResultView state={ready(bike())} inputs={INPUTS} now={NOW} />);
    expect(screen.queryByText(/^Leave by/)).not.toBeInTheDocument();
    rerender(<TripResultView state={ready(bike())} inputs={{ ...INPUTS, timeMode: 'arrive' }} now={NOW} />);
    expect(screen.getByText('Leave by 5:08 AM to arrive by 5:30 AM')).toBeInTheDocument();
  });

  it('shows the limited-data note only when the data is thin', () => {
    const { rerender } = render(<TripResultView state={ready(bike())} inputs={INPUTS} now={NOW} />);
    expect(screen.queryByText('Limited data')).not.toBeInTheDocument();
    rerender(<TripResultView state={ready(bike({ limitedData: true }))} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('Limited data')).toBeInTheDocument();
  });

  it('prefixes the header with the trip day', () => {
    const { rerender } = render(<TripResultView state={ready(bike())} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('Tomorrow · 5:08 AM → 5:30 AM')).toBeInTheDocument();
    rerender(<TripResultView state={ready(bike())} inputs={INPUTS} now={new Date('2026-11-03T04:00:00Z')} />);
    expect(screen.getByText('Today · 5:08 AM → 5:30 AM')).toBeInTheDocument();
    rerender(<TripResultView state={ready(bike())} inputs={INPUTS} now={new Date('2026-10-30T10:00:00Z')} />);
    expect(screen.getByText('Tue 3 Nov · 5:08 AM → 5:30 AM')).toBeInTheDocument();
  });

  describe('a time that has already passed', () => {
    const LATER = new Date('2026-11-03T04:09:00Z'); // 05:09 in Ljubljana, a minute after the 05:08 input
    const walk: TripResult = { kind: 'walk', depart: DEPART, arrive: ARRIVE, legs: [leg('walk', 1320)] };

    it('is noted on a bike result, and the plan is still shown', () => {
      render(<TripResultView state={ready(bike())} inputs={INPUTS} now={LATER} />);
      expect(screen.getByText('This time has already passed.')).toHaveClass('warn');
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('is noted on a walk result', () => {
      render(<TripResultView state={ready(walk)} inputs={INPUTS} now={LATER} />);
      expect(screen.getByText('This time has already passed.')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });

    it('is not noted for a time that is still ahead', () => {
      render(<TripResultView state={ready(bike())} inputs={INPUTS} now={NOW} />);
      expect(screen.queryByText('This time has already passed.')).not.toBeInTheDocument();
    });
  });

  it('shows the chance as a coloured dot while the label keeps the text colour', () => {
    render(<TripResultView state={ready(bike())} inputs={INPUTS} now={NOW} />);
    const bikeChance = screen.getByText('Bike likely · 9 in 10');
    const dot = bikeChance.querySelector('.trip-chance-dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveStyle({ backgroundColor: colorFor(1 - 0.95) });
    expect(bikeChance).not.toHaveStyle({ color: colorFor(1 - 0.95) });
    const dockDot = screen.getByText('Free dock unlikely · 4 in 10').querySelector('.trip-chance-dot');
    expect(dockDot).toHaveStyle({ backgroundColor: colorFor(1 - 0.4) });
  });

  it('has no dot when the chance is unknown', () => {
    render(<TripResultView state={ready(bike({ pickup: odds(0, null, false) }))} inputs={INPUTS} now={NOW} />);
    expect(screen.getByText('Bike chance unknown').querySelector('.trip-chance-dot')).toBeNull();
  });
});
