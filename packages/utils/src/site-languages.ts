import { COMPAT_SITE_LANGUAGES, readSiteLanguages, type SiteLanguages } from './locales';

export type SiteLanguagesResult =
  | { readonly state: 'ok'; readonly value: SiteLanguages }
  | { readonly state: 'not-configured' }
  | { readonly state: 'failed'; readonly reason: string };

export interface SiteLanguagesRequest {
  readonly baseUrl: string | undefined;
  readonly slug: string | null;
  readonly apiKey?: string | undefined;
  readonly fetchInit?: RequestInit;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export async function fetchSiteLanguages(request: SiteLanguagesRequest): Promise<SiteLanguagesResult> {
  const base = request.baseUrl?.trim().replace(/\/$/, '');
  if (!base || request.slug === null) return { state: 'not-configured' };
  const doFetch = request.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${base}/cms/sites/${encodeURIComponent(request.slug)}`, {
      ...request.fetchInit,
      headers: request.apiKey ? { 'X-API-Key': request.apiKey } : {},
      signal: AbortSignal.timeout(request.timeoutMs ?? 1_500),
    });
    if (!res.ok) return { state: 'failed', reason: `HTTP ${res.status}` };
    return { state: 'ok', value: readSiteLanguages(await res.json()) };
  } catch (error) {
    return { state: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

export function settle(result: SiteLanguagesResult, lastGood: SiteLanguages | null): SiteLanguages {
  if (result.state === 'ok') return result.value;
  return lastGood ?? COMPAT_SITE_LANGUAGES;
}
