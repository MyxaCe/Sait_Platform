import type { EconomicEvent } from '@/features/analytics/EconomicCalendar';

export interface CalendarData {
  events: EconomicEvent[];
  lang: string | null;
  source: string;
  complete: boolean;
}

export type CalendarUnavailableReason = 'network' | 'http-error' | 'malformed';

export type CalendarResult =
  | { state: 'not-configured' }
  | { state: 'ok'; data: CalendarData; stale: boolean; fetchedAt: number }
  | { state: 'unavailable'; reason: CalendarUnavailableReason };

export interface CalendarQuery {
  from: string;
  to: string;
  lang: string;
}

interface LoadOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export const CALENDAR_FRESH_MS = 60_000;
export const CALENDAR_STALE_MS = 6 * 60 * 60_000;
export const MAX_WEEK_OFFSET = 4;

const cache = new Map<string, { data: CalendarData; at: number }>();

export function resetCalendarCache(): void {
  cache.clear();
}

export function maskCalendarUrl(base: string): string {
  try {
    const url = new URL(base);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return '<неверный адрес>/…';
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function utcWeek(now: Date, offset = 0): { from: string; to: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) + offset * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}

export function parseWeekOffset(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return 0;
  const n = Number(value);
  return Math.abs(n) <= MAX_WEEK_OFFSET ? n : 0;
}

function optionalValue(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim() === '' ? null : value;
}

export function parseCalendarEvent(raw: unknown): EconomicEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.datetime !== 'string' || Number.isNaN(Date.parse(r.datetime))) return null;
  if (typeof r.currency !== 'string' || r.currency === '') return null;
  if (typeof r.title !== 'string' || r.title.trim() === '') return null;
  if (r.importance !== 1 && r.importance !== 2 && r.importance !== 3) return null;
  const previous = optionalValue(r.previous);
  const forecast = optionalValue(r.forecast);
  const actual = optionalValue(r.actual);
  if (previous === undefined || forecast === undefined || actual === undefined) return null;
  if (r.allDay !== undefined && typeof r.allDay !== 'boolean') return null;
  return {
    id: r.id,
    datetime: new Date(r.datetime).toISOString(),
    currency: r.currency,
    title: r.title,
    importance: r.importance,
    previous,
    forecast,
    actual,
    allDay: r.allDay === true,
  };
}

export function parseCalendarResponse(
  body: unknown,
): { data: CalendarData; dropped: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.events)) return null;
  const events: EconomicEvent[] = [];
  for (const raw of b.events) {
    const event = parseCalendarEvent(raw);
    if (event) events.push(event);
  }
  events.sort((a, z) => a.datetime.localeCompare(z.datetime));
  return {
    data: {
      events,
      lang: typeof b.lang === 'string' && b.lang !== '' ? b.lang : null,
      source: typeof b.source === 'string' ? b.source.trim() : '',
      complete: b.complete !== false,
    },
    dropped: b.events.length - events.length,
  };
}

export async function loadCalendar(
  query: CalendarQuery,
  { env = process.env, fetchImpl = fetch, now = Date.now }: LoadOptions = {},
): Promise<CalendarResult> {
  const base = env.CALENDAR_API_URL?.trim();
  if (!base) return { state: 'not-configured' };

  const key = `${base}|${query.from}|${query.to}|${query.lang}`;
  const cached = cache.get(key);
  const started = now();
  if (cached && started - cached.at < CALENDAR_FRESH_MS) {
    return { state: 'ok', data: cached.data, stale: false, fetchedAt: cached.at };
  }

  const params = new URLSearchParams({ from: query.from, to: query.to, lang: query.lang });
  const url = `${base.replace(/\/+$/, '')}/calendar/v1/events?${params}`;
  const masked = maskCalendarUrl(base);

  let reason: CalendarUnavailableReason;
  let detail: string;
  try {
    const res = await fetchImpl(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      reason = 'http-error';
      detail = `HTTP ${res.status}`;
    } else {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const parsed = parseCalendarResponse(body);
      if (parsed) {
        if (parsed.dropped > 0) {
          console.warn(
            `[calendar] ${masked}: отброшено событий с битыми полями: ${parsed.dropped} (${query.from}…${query.to}, ${query.lang})`,
          );
        }
        const at = now();
        cache.set(key, { data: parsed.data, at });
        for (const [k, v] of cache) if (at - v.at > CALENDAR_STALE_MS) cache.delete(k);
        return { state: 'ok', data: parsed.data, stale: false, fetchedAt: at };
      }
      reason = 'malformed';
      detail = 'тело не по контракту';
    }
  } catch (error) {
    reason = 'network';
    detail = error instanceof Error ? error.name : 'ошибка';
  }

  const fallback = cached && started - cached.at <= CALENDAR_STALE_MS ? cached : null;
  console.error(
    `[calendar] ${masked}: ${reason} (${detail}) ${query.from}…${query.to} ${query.lang} — ${
      fallback ? 'показан последний удачный ответ' : 'временно недоступно'
    }`,
  );
  if (fallback) return { state: 'ok', data: fallback.data, stale: true, fetchedAt: fallback.at };
  return { state: 'unavailable', reason };
}
