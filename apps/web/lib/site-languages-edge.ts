import { readTenantSlug } from '@broker/tenant';
import type { SiteLanguages } from '@broker/utils/locales';
import { fetchSiteLanguages, settle } from './site-languages-source';

const TTL_MS = 30_000;

let cache: { at: number; value: SiteLanguages } | null = null;
let lastGood: SiteLanguages | null = null;
let inflight: Promise<SiteLanguages> | null = null;

export async function siteLanguagesForMiddleware(
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<SiteLanguages> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    const result = await fetchSiteLanguages({
      baseUrl: process.env.CMS_API_URL,
      slug: readTenantSlug(process.env.SITE_SLUG),
      apiKey: process.env.CMS_API_KEY,
      fetchImpl,
      fetchInit: { cache: 'no-store' },
    });
    if (result.state === 'ok') lastGood = result.value;
    const value = settle(result, lastGood);
    cache = { at: now, value };
    return value;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function resetSiteLanguagesCache(): void {
  cache = null;
  lastGood = null;
  inflight = null;
}
