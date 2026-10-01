import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BASE_URL, FAIL, allRoutes, makeProfile, mockFetch, requestedFiles } from '../test/fixtures';
import type { Day } from './types';
import { useTypical } from './useTypical';

function render(day: Day) {
  return renderHook(({ d }) => useTypical(BASE_URL, d), { initialProps: { d: day } });
}

describe('useTypical', () => {
  it('loads meta and the selected profile, then prefetches the other six days', async () => {
    const fetchFn = mockFetch(allRoutes());
    const { result } = render('mon');
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.meta?.stations).toHaveLength(2);
    expect(result.current.profile?.profile).toBe('mon');
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(8));
    expect(requestedFiles(fetchFn).slice(0, 2).sort()).toEqual(['meta.json', 'mon.json']);
  });

  it('switching to a prefetched day does not fetch again', async () => {
    const fetchFn = mockFetch(allRoutes());
    const { result, rerender } = render('mon');
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(8));
    rerender({ d: 'wed' });
    await waitFor(() => expect(result.current.profile?.profile).toBe('wed'));
    expect(result.current.status).toBe('ready');
    expect(fetchFn).toHaveBeenCalledTimes(8);
  });

  it('reports an error, and retry fetches the failed file again', async () => {
    const routes = allRoutes();
    routes['mon.json'] = FAIL;
    mockFetch(routes);
    const { result } = render('mon');
    await waitFor(() => expect(result.current.status).toBe('error'));
    routes['mon.json'] = makeProfile('mon');
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('a malformed profile is an error, not a partial render', async () => {
    const routes = allRoutes();
    routes['mon.json'] = { profile: 'mon', days_used: 1, stations: { '1': { bikes: [1] } } };
    mockFetch(routes);
    const { result } = render('mon');
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.profile).toBeNull();
  });

  it('a day whose prefetch failed is fetched again when selected', async () => {
    const routes = allRoutes();
    routes['wed.json'] = FAIL;
    const fetchFn = mockFetch(routes);
    const { result, rerender } = render('mon');
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(8));
    expect(result.current.status).toBe('ready'); // failed prefetch is silent
    routes['wed.json'] = makeProfile('wed');
    rerender({ d: 'wed' });
    await waitFor(() => expect(result.current.profile?.profile).toBe('wed'));
    expect(fetchFn).toHaveBeenCalledTimes(9);
  });
});
