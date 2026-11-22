import { parseLiveSnapshot, type LiveSnapshot } from '@broker/live-params';
import { envOr } from '@broker/utils';

const TIMEOUT_MS = 1_500;

export function platformTermsUrl(): string | null {
  const base = envOr(process.env.CABINET_INTERNAL_URL, envOr(process.env.NEXT_PUBLIC_CABINET_URL, '')).replace(/\/$/, '');
  return base ? `${base}/api/public/platform-terms` : null;
}

export function parsePlatformTerms(body: unknown): LiveSnapshot | null {
  const live = (body as { live?: unknown } | null)?.live;
  if (!live || typeof live !== 'object') return null;
  return parseLiveSnapshot(live);
}

export async function fetchLiveSnapshot(fetchImpl: typeof fetch = fetch): Promise<LiveSnapshot | null> {
  const url = platformTermsUrl();
  if (!url) return null;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 60 },
    } as RequestInit);
    if (!res.ok) return null;
    return parsePlatformTerms(await res.json());
  } catch {
    return null;
  }
}
