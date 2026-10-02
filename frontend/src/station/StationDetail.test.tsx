import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { META, makeProfile, series, stationSeries } from '../test/fixtures';
import { BottomSheet } from './BottomSheet';
import { DayChart } from './DayChart';
import { StationDetail } from './StationDetail';

const station = META.stations[0];

function bars() {
  return screen.getAllByRole('button').filter((b) => b.classList.contains('bar-hit'));
}

describe('StationDetail', () => {
  it('bikes mode: title-cased name, typical bikes, chance empty, capacity', () => {
    render(<StationDetail station={station} profile={makeProfile('mon')} slot={36} mode="bikes" compact={false} onSlot={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Prešernov Trg-Petkovškovo Nabrežje' })).toBeInTheDocument();
    expect(screen.getByText(/Typically/)).toHaveTextContent('Typically 5 bikes · 5 % chance empty');
    expect(screen.getByText('Capacity 20')).toBeInTheDocument();
  });

  it('docks mode: typical free docks and chance full', () => {
    render(<StationDetail station={station} profile={makeProfile('mon')} slot={36} mode="docks" compact={false} onSlot={vi.fn()} />);
    expect(screen.getByText(/Typically/)).toHaveTextContent('Typically 15 free docks · 2 % chance full');
  });

  it('rounds the typical count', () => {
    const profile = makeProfile('mon', { stations: { '1': stationSeries({ bikes: series(6.6) }) } });
    render(<StationDetail station={station} profile={profile} slot={0} mode="bikes" compact={false} onSlot={vi.fn()} />);
    expect(screen.getByText(/Typically/)).toHaveTextContent('Typically 7 bikes');
  });

  it('station missing from profile shows no data', () => {
    const profile = makeProfile('mon', { stations: {} });
    render(<StationDetail station={station} profile={profile} slot={36} mode="bikes" compact={false} onSlot={vi.fn()} />);
    expect(screen.getByText('No data for this time')).toBeInTheDocument();
    expect(bars()).toHaveLength(96);
  });
});

describe('DayChart', () => {
  it('desktop: 96 bars, selected slot marked, click selects that slot', async () => {
    const onSelect = vi.fn();
    render(<DayChart values={series(0.2)} slot={36} compact={false} onSelect={onSelect} />);
    expect(bars()).toHaveLength(96);
    expect(screen.getByRole('button', { name: '9:00 AM: 20 %' })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('button', { name: '5:15 PM: 20 %' }));
    expect(onSelect).toHaveBeenCalledWith(69);
  });

  it('compact: 24 hourly bars, click selects the first slot of the hour', async () => {
    const onSelect = vi.fn();
    render(<DayChart values={series(0.2)} slot={37} compact onSelect={onSelect} />);
    expect(bars()).toHaveLength(24);
    expect(screen.getByRole('button', { name: '9:00 AM: 20 %' })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('button', { name: '8:00 PM: 20 %' }));
    expect(onSelect).toHaveBeenCalledWith(80);
  });

  it('compact highlights hour 23 at slot 95', () => {
    render(<DayChart values={series(0.2)} slot={95} compact onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: '11:00 PM: 20 %' })).toHaveAttribute('aria-current', 'true');
  });

  it('null slots are labelled no data', () => {
    render(<DayChart values={series(null)} slot={0} compact={false} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: '12:00 AM: no data' })).toBeInTheDocument();
  });
});

describe('BottomSheet', () => {
  it('closes from the close button', async () => {
    const onClose = vi.fn();
    render(<BottomSheet onClose={onClose}>content</BottomSheet>);
    const sheet = screen.getByRole('dialog', { name: 'Station details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a downward swipe of the handle, not on a small drag', () => {
    const onClose = vi.fn();
    const { container } = render(<BottomSheet onClose={onClose}>content</BottomSheet>);
    const handle = container.querySelector('.sheet-handle')!;
    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerUp(handle, { clientY: 120 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerUp(handle, { clientY: 200 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
