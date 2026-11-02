/**
 * Cache of in-flight and finished requests, shared by callers. The cached fetch never sees a caller's
 * signal (one caller aborting must not fail the others, nor poison the entry); each caller races the
 * shared promise against its own signal instead. An aborted caller rejects with the signal's reason,
 * as fetch does, while the request carries on and fills the cache. Failed requests are evicted.
 */
export async function cachedRequest<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw signal.reason;

  let pending = cache.get(key);
  if (!pending) {
    const request = load();
    pending = request;
    cache.set(key, request);
    request.catch(() => {
      if (cache.get(key) === request) cache.delete(key);
    });
  }
  return signal ? raceAbort(pending, signal) : pending;
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
