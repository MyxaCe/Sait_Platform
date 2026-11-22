import { envOr } from '@broker/utils';

const TTL_MS = 60_000;
const TIMEOUT_MS = 800;

let cache: { at: number; days: number | null } | null = null;

export async function attributionWindowDays(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<number | null> {
  if (cache && now - cache.at < TTL_MS) return cache.days;
  const base = envOr(process.env.CABINET_INTERNAL_URL, envOr(process.env.NEXT_PUBLIC_CABINET_URL, '')).replace(/\/$/, '');
  let days: number | null = null;
  if (base) {
    try {
      const res = await fetchImpl(`${base}/api/public/platform-terms`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const v = Number(((await res.json()) as { attributionWindowDays?: unknown }).attributionWindowDays);
        days = Number.isInteger(v) && v >= 1 && v <= 365 ? v : null;
      }
    } catch {
      days = null;
    }
  }
  cache = { at: now, days };
  return days;
}

export function resetAttributionConfigCache(): void {
  cache = null;
}
