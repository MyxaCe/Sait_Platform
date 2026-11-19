export const MAX_TTL_MS = 60_000;

export interface CachedLoaderOptions {
  ttlMs?: number;
  failureTtlMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export function createCachedLoader<T>(load: () => Promise<T>, options: CachedLoaderOptions = {}): () => Promise<T | null> {
  const ttlMs = Math.min(options.ttlMs ?? MAX_TTL_MS, MAX_TTL_MS);
  const failureTtlMs = Math.min(options.failureTtlMs ?? 5_000, ttlMs);
  const now = options.now ?? Date.now;
  const onError = options.onError ?? ((error: unknown) => console.error('[live-params] настройки платформы не прочитаны', error));
  let entry: { value: T | null; expiresAt: number } | null = null;
  let inflight: Promise<T | null> | null = null;

  return async () => {
    if (entry && entry.expiresAt > now()) return entry.value;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const value = await load();
        entry = { value, expiresAt: now() + ttlMs };
        return value;
      } catch (error) {
        onError(error);
        entry = { value: null, expiresAt: now() + failureTtlMs };
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}
