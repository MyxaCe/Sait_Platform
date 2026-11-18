import { AUTH_ERROR_CODES, INTERNAL_AUTH_HEADER, internalAuthValue } from './terminal-contract';
import type { TerminalUnavailable } from './terminal-money';

export const MAX_MIN_STOP_BPS = 10_000;

export const stopsRoute = (tenant: string) => `/internal/sites/${encodeURIComponent(tenant)}/settings/stops`;

export const isMinStopBps = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_MIN_STOP_BPS;

export function parseStopsResponse(body: unknown): number | null {
  const v = (body as { min_stop_bps?: unknown } | null)?.min_stop_bps;
  return isMinStopBps(v) ? v : null;
}

export type StopsOutcome =
  | { state: 'ok'; minStopBps: number }
  | { state: 'refused'; code: string; status: number }
  | { state: 'unavailable'; reason: TerminalUnavailable };

export interface TerminalStopsClient {
  getMinStop(): Promise<StopsOutcome>;
  setMinStop(minStopBps: number): Promise<StopsOutcome>;
}

export function createTerminalStopsClient(config: {
  baseUrl: string | undefined;
  token: string | undefined;
  tenant: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): TerminalStopsClient {
  const baseUrl = config.baseUrl?.trim().replace(/\/$/, '');
  const token = config.token?.trim();
  const tenant = config.tenant?.trim();
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 8_000;

  async function call(method: 'GET' | 'PUT', body?: unknown): Promise<StopsOutcome> {
    if (!baseUrl || !token || !tenant) return { state: 'unavailable', reason: 'not-configured' };
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${stopsRoute(tenant)}`, {
        method,
        headers: { 'content-type': 'application/json', [INTERNAL_AUTH_HEADER]: internalAuthValue(token) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { state: 'unavailable', reason: 'network' };
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.status >= 200 && res.status < 300) {
      const v = parseStopsResponse(json);
      return v === null ? { state: 'unavailable', reason: 'malformed' } : { state: 'ok', minStopBps: v };
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) return { state: 'unavailable', reason: 'auth' };
    if (res.status === 400) {
      const code = (json as { error?: unknown } | null)?.error;
      return { state: 'refused', code: typeof code === 'string' && code ? code : 'invalid_min_stop_bps', status: 400 };
    }
    if (res.status >= 400 && res.status < 500) {
      const code = (json as { error?: unknown } | null)?.error;
      if (typeof code !== 'string' || !code) return { state: 'unavailable', reason: 'http-error' };
      if (AUTH_ERROR_CODES.includes(code)) return { state: 'unavailable', reason: 'auth' };
      return { state: 'refused', code, status: res.status };
    }
    return { state: 'unavailable', reason: 'http-error' };
  }

  return {
    getMinStop: () => call('GET'),
    async setMinStop(minStopBps) {
      if (!isMinStopBps(minStopBps)) return { state: 'refused', code: 'invalid_min_stop_bps', status: 400 };
      return call('PUT', { min_stop_bps: minStopBps });
    },
  };
}

export function terminalStopsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs?: number,
): TerminalStopsClient {
  return createTerminalStopsClient({
    baseUrl: env.TERMINAL_INTERNAL_URL,
    token: env.INTERNAL_MONEY_TOKEN,
    tenant: env.SITE_SLUG,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}
