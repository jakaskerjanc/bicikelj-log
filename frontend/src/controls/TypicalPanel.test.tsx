import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TypicalPanel, type TypicalPanelProps } from './TypicalPanel';

function setup(overrides: Partial<TypicalPanelProps> = {}) {
  const props: TypicalPanelProps = {
    day: 'mon',
    slot: 36,
    mode: 'bikes',
    onDay: vi.fn(),
    onSlot: vi.fn(),
    onMode: vi.fn(),
    status: 'ready',
    daysUsed: 4.2,
    onRetry: vi.fn(),
    ...overrides,
  };
  render(<TypicalPanel {...props} />);
  return props;
}

describe('TypicalPanel', () => {
  it('shows the day and time label', () => {
    setup();
    expect(screen.getByText('Monday, 09:00')).toBeInTheDocument();
  });

  it('day chips read M T W T F S S, Monday first, with the current day pressed', () => {
    setup();
    const chips = screen.getAllByRole('button').filter((b) => b.classList.contains('chip'));
    expect(chips.map((c) => c.textContent).join(' ')).toBe('M T W T F S S');
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a chip selects that day', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(props.onDay).toHaveBeenCalledWith('wed');
  });

  it('moving the slider reports the slot as a number', () => {
    const props = setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Time of day' }), { target: { value: '40' } });
    expect(props.onSlot).toHaveBeenCalledWith(40);
  });

  it('the mode toggle switches mode and the legend word follows the mode', async () => {
    const props = setup();
    expect(screen.getByText('Empty')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Docks' }));
    expect(props.onMode).toHaveBeenCalledWith('docks');
  });

  it('legend says Full in docks mode', () => {
    setup({ mode: 'docks' });
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Docks' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows Limited data only when days_used < 2', () => {
    setup({ daysUsed: 1.4 });
    expect(screen.getByText('Limited data')).toBeInTheDocument();
  });

  it('hides Limited data at exactly 2 days', () => {
    setup({ daysUsed: 2 });
    expect(screen.queryByText('Limited data')).not.toBeInTheDocument();
  });

  it('shows a loading indicator while loading', () => {
    setup({ status: 'loading', daysUsed: null });
    expect(screen.getByRole('status', { name: 'Loading data' })).toBeInTheDocument();
  });

  it('shows an error with Retry', async () => {
    const props = setup({ status: 'error', daysUsed: null });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load data.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalled();
  });
});
