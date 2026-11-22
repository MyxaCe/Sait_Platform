export const STATUS_CHECK_KEYS = ['site', 'cabinet', 'terminal', 'quotes', 'cms', 'storage'] as const;
export type StatusCheckKey = (typeof STATUS_CHECK_KEYS)[number];

export type Signal = { selector: string } | { expr: string };

export const CHECK_SIGNALS: Record<StatusCheckKey, Signal[]> = {
  site: [
    { selector: 'probe_success{job="snaruzhi",instance=~"https://[^/]+/"}' },
    { selector: 'probe_success{job="vnutri",instance=~"http://broker-web:.*"}' },
  ],
  cabinet: [
    { selector: 'probe_success{job="snaruzhi",instance=~"https://cabinet[.].*"}' },
    { selector: 'probe_success{job="vnutri",instance=~"http://broker-cabinet:.*"}' },
  ],
  terminal: [
    { selector: 'probe_success{job="snaruzhi",instance=~"https://terminal[.].*"}' },
    { selector: 'probe_success{job="vnutri",instance=~"http://broker-terminal-(gateway|web):.*"}' },
  ],
  quotes: [
    { selector: 'probe_success{job="vnutri",instance=~"http://broker-mds:.*"}' },
    { expr: 'terminal_feed_age_seconds <= bool 120' },
    { expr: 'mds_quotes_fresh > bool 0' },
  ],
  cms: [
    { selector: 'probe_success{job="snaruzhi-admin"}' },
    { selector: 'probe_success{job="vnutri",instance=~"http://broker-cms:.*"}' },
  ],
  storage: [{ selector: 'probe_success{job="hranilishcha"}' }],
};

export const STATUS_FRESH_MS = 30_000;
export const STATUS_STALE_MS = 2 * 60_000;
export const UPTIME_FRESH_MS = 10 * 60_000;
export const OUTAGE_WINDOW = '5m';
export const MAX_PERIOD_DAYS = 90;

export type CheckStatus = 'operational' | 'degraded' | 'outage' | 'unknown';

export interface LiveCheck {
  status: CheckStatus;
  uptime: number | null;
}

export type LiveStatus =
  | { state: 'not-configured' }
  | { state: 'unavailable' }
  | {
      state: 'ok';
      checks: Record<StatusCheckKey, LiveCheck>;
      periodDays: number | null;
      at: number;
    };

export function isStatusCheckKey(value: unknown): value is StatusCheckKey {
  return typeof value === 'string' && (STATUS_CHECK_KEYS as readonly string[]).includes(value);
}

function over(signal: Signal, fn: string, window: string, step: string): string {
  return 'selector' in signal
    ? `${fn}(${signal.selector}[${window}])`
    : `${fn}((${signal.expr})[${window}:${step}])`;
}

function tag(expr: string, check: string, index: number): string {
  return `label_replace(label_replace(${expr}, "status_check", "${check}", "", ""), "status_signal", "${index}", "", "")`;
}

function tagged(build: (signal: Signal) => string): string {
  return STATUS_CHECK_KEYS.flatMap((check) =>
    CHECK_SIGNALS[check].map((signal, i) => tag(build(signal), check, i)),
  ).join(' or ');
}

export function nowQuery(): string {
  return tagged((s) => ('selector' in s ? s.selector : `(${s.expr})`));
}

export function outageQuery(): string {
  return tagged((s) => over(s, 'max_over_time', OUTAGE_WINDOW, '15s'));
}

export function uptimeQuery(days: number): string {
  return tagged((s) => over(s, 'avg_over_time', `${Math.max(1, days)}d`, '1m'));
}

export const AGE_QUERY = `time() - min(min_over_time(timestamp(probe_success)[${MAX_PERIOD_DAYS}d:1h]))`;

export interface Sample {
  check: string;
  signal: number;
  key: string;
  value: number;
}

export function parseVector(body: unknown): Sample[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { status?: unknown; data?: { resultType?: unknown; result?: unknown } };
  if (b.status !== 'success' || !b.data || b.data.resultType !== 'vector') return null;
  if (!Array.isArray(b.data.result)) return null;
  const out: Sample[] = [];
  for (const row of b.data.result as { metric?: Record<string, string>; value?: unknown }[]) {
    const metric = row.metric ?? {};
    const raw = Array.isArray(row.value) ? Number(row.value[1]) : NaN;
    if (!Number.isFinite(raw)) continue;
    const { __name__: _, ...labels } = metric;
    out.push({
      check: labels.status_check ?? '',
      signal: Number(labels.status_signal ?? -1),
      key: JSON.stringify(Object.entries(labels).sort(([a], [z]) => a.localeCompare(z))),
      value: raw,
    });
  }
  return out;
}

export function parseScalarVector(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { status?: unknown; data?: { resultType?: unknown; result?: unknown } };
  if (b.status !== 'success' || !b.data || !Array.isArray(b.data.result)) return null;
  const first = (b.data.result as { value?: unknown }[])[0];
  const raw = first && Array.isArray(first.value) ? Number(first.value[1]) : NaN;
  return Number.isFinite(raw) ? raw : null;
}

export function periodDaysFromAge(ageSeconds: number | null): number | null {
  if (ageSeconds === null || ageSeconds < 0) return null;
  return Math.min(MAX_PERIOD_DAYS, Math.floor(ageSeconds / 86_400));
}

export function computeStatus(check: StatusCheckKey, now: Sample[], recent: Sample[]): CheckStatus {
  const signals = CHECK_SIGNALS[check];
  const probes = new Map<string, { now?: number; recent?: number }>();
  for (const s of now) if (s.check === check) probes.set(s.key, { ...probes.get(s.key), now: s.value });
  for (const s of recent) if (s.check === check) probes.set(s.key, { ...probes.get(s.key), recent: s.value });
  if (probes.size === 0) return 'unknown';

  const reported = new Set([...now, ...recent].filter((s) => s.check === check).map((s) => s.signal));
  const silent = signals.length - signals.filter((_, i) => reported.has(i)).length;

  const all = [...probes.values()];
  if (all.every((p) => !(p.recent !== undefined && p.recent > 0))) return 'outage';
  if (silent > 0 || all.some((p) => p.now !== 1)) return 'degraded';
  return 'operational';
}

export function computeUptime(check: StatusCheckKey, samples: Sample[] | null): number | null {
  if (!samples) return null;
  const values = samples.filter((s) => s.check === check).map((s) => Math.min(1, Math.max(0, s.value)));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

interface LoadOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

let statusCache: { at: number; result: Extract<LiveStatus, { state: 'ok' }> } | null = null;
let uptimeCache: { at: number; base: string; samples: Sample[]; periodDays: number | null } | null = null;
let inflight: Promise<LiveStatus> | null = null;

export function resetLiveStatusCache(): void {
  statusCache = null;
  uptimeCache = null;
  inflight = null;
}

async function query(base: string, promql: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(`${base}/api/v1/query`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ query: promql }).toString(),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadUptime(
  base: string,
  fetchImpl: typeof fetch,
  at: number,
): Promise<{ samples: Sample[]; periodDays: number | null } | null> {
  if (uptimeCache && uptimeCache.base === base && at - uptimeCache.at < UPTIME_FRESH_MS) return uptimeCache;
  try {
    const periodDays = periodDaysFromAge(parseScalarVector(await query(base, AGE_QUERY, fetchImpl)));
    const samples = parseVector(await query(base, uptimeQuery(periodDays ?? 1), fetchImpl));
    if (!samples) throw new Error('ответ не по формату');
    uptimeCache = { at, base, samples, periodDays };
    return uptimeCache;
  } catch (error) {
    console.error(`[status] uptime не получен: ${error instanceof Error ? error.message : String(error)}`);
    return uptimeCache && uptimeCache.base === base ? uptimeCache : null;
  }
}

async function refresh(base: string, fetchImpl: typeof fetch, at: number): Promise<LiveStatus> {
  try {
    const [nowBody, recentBody] = await Promise.all([
      query(base, nowQuery(), fetchImpl),
      query(base, outageQuery(), fetchImpl),
    ]);
    const nowSamples = parseVector(nowBody);
    const recentSamples = parseVector(recentBody);
    if (!nowSamples || !recentSamples) throw new Error('ответ не по формату');
    const uptime = await loadUptime(base, fetchImpl, at);
    const checks = Object.fromEntries(
      STATUS_CHECK_KEYS.map((key) => [
        key,
        {
          status: computeStatus(key, nowSamples, recentSamples),
          uptime: computeUptime(key, uptime?.samples ?? null),
        },
      ]),
    ) as Record<StatusCheckKey, LiveCheck>;
    const result = { state: 'ok' as const, checks, periodDays: uptime?.periodDays ?? null, at };
    statusCache = { at, result };
    return result;
  } catch (error) {
    const fallback = statusCache && at - statusCache.at <= STATUS_STALE_MS ? statusCache.result : null;
    console.error(
      `[status] мониторинг недоступен (${error instanceof Error ? error.message : String(error)}) — ${
        fallback ? 'показан последний ответ' : 'статус временно недоступен'
      }`,
    );
    return fallback ?? { state: 'unavailable' };
  }
}

export async function loadLiveStatus({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
}: LoadOptions = {}): Promise<LiveStatus> {
  const base = env.STATUS_PROMETHEUS_URL?.trim().replace(/\/+$/, '');
  if (!base) return { state: 'not-configured' };
  const at = now();
  if (statusCache && at - statusCache.at < STATUS_FRESH_MS) return statusCache.result;
  if (!inflight) inflight = refresh(base, fetchImpl, at).finally(() => (inflight = null));
  return inflight;
}
