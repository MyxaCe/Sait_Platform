const buckets = new Map<string, number[]>();

export function isRateLimited(key: string, limit = 5, windowMs = 60_000, now = Date.now()): boolean {
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

export function __resetRateLimit() {
  buckets.clear();
}
