import { useCallback, useEffect, useState } from 'react';
import { fetchMeta, fetchProfile } from './api';
import { DAYS, type Day, type Meta, type Profile } from './types';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface TypicalData {
  meta: Meta | null;
  profile: Profile | null;
  status: LoadStatus;
  retry: () => void;
}

/** One promise per file per page load; a failed promise is forgotten so the next request retries. */
function createLoader(baseUrl: string) {
  const cache = new Map<string, Promise<unknown>>();
  function load<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    let promise = cache.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = fetcher();
      cache.set(key, promise);
      promise.catch(() => cache.delete(key));
    }
    return promise;
  }
  return {
    meta: () => load('meta', () => fetchMeta(baseUrl)),
    profile: (day: Day) => load(day, () => fetchProfile(baseUrl, day)),
  };
}

export function useTypical(baseUrl: string, day: Day): TypicalData {
  const [loader] = useState(() => createLoader(baseUrl));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [profiles, setProfiles] = useState<Partial<Record<Day, Profile>>>({});
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setFailed(false);
    const store = (p: Profile) => setProfiles((prev) => (prev[p.profile] ? prev : { ...prev, [p.profile]: p }));
    Promise.all([loader.meta(), loader.profile(day)]).then(
      ([m, p]) => {
        if (!current) return;
        setMeta(m);
        store(p);
        // Prefetch the other days so switching is instant; a failure here is retried on selection.
        for (const other of DAYS) if (other !== day) loader.profile(other).then(store, () => {});
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [loader, day, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const profile = profiles[day] ?? null;
  const status: LoadStatus = failed ? 'error' : meta && profile ? 'ready' : 'loading';
  return { meta, profile, status, retry };
}
