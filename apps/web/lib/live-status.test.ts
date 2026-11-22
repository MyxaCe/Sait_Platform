import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGE_QUERY,
  CHECK_SIGNALS,
  STATUS_CHECK_KEYS,
  STATUS_FRESH_MS,
  STATUS_STALE_MS,
  computeStatus,
  computeUptime,
  loadLiveStatus,
  nowQuery,
  outageQuery,
  parseVector,
  periodDaysFromAge,
  resetLiveStatusCache,
  uptimeQuery,
  type StatusCheckKey,
} from './live-status';

const BASE = 'http://broker-prometheus:9090';
const env = { STATUS_PROMETHEUS_URL: BASE };

type Row = [check: StatusCheckKey, signal: number, value: number, instance?: string];

function vector(rows: Row[]) {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: rows.map(([check, signal, value, instance]) => ({
        metric: {
          __name__: 'probe_success',
          instance: instance ?? `${check}-${signal}`,
          status_check: check,
          status_signal: String(signal),
        },
        value: [1_795_000_000, String(value)],
      })),
    },
  };
}

function allSignals(value: number): Row[] {
  return STATUS_CHECK_KEYS.flatMap((check) => CHECK_SIGNALS[check].map((_, i): Row => [check, i, value]));
}

const scalar = (v: number) => ({ status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [0, String(v)] }] } });

function prometheus(answers: { now: unknown; recent: unknown; uptime?: unknown; age?: unknown }) {
  const calls: string[] = [];
  const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const q = new URLSearchParams(String(init?.body)).get('query') ?? '';
    calls.push(q);
    const body =
      q === AGE_QUERY
        ? (answers.age ?? scalar(29.5 * 86_400))
        : q.startsWith('label_replace(label_replace(avg_over_time')
          ? (answers.uptime ?? vector(allSignals(1)))
          : q.startsWith('label_replace(label_replace(max_over_time')
            ? answers.recent
            : answers.now;
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('запросы к Prometheus', () => {
  it('каждая проверка помечена ключом и номером сигнала, домены не зашиты', () => {
    const q = nowQuery();
    for (const key of STATUS_CHECK_KEYS) {
      CHECK_SIGNALS[key].forEach((_, i) => {
        expect(q).toContain(`"status_check", "${key}"`);
        expect(q).toContain(`"status_signal", "${i}"`);
      });
    }
    expect(q).not.toMatch(/\.com|\.ru|\d+\.\d+\.\d+\.\d+/);
  });

  it('окно отказа — 5 минут, uptime — за N дней (бинарные выражения через подзапрос)', () => {
    expect(outageQuery()).toContain('max_over_time(probe_success{job="hranilishcha"}[5m])');
    expect(outageQuery()).toContain('max_over_time((mds_quotes_fresh > bool 0)[5m:15s])');
    expect(uptimeQuery(29)).toContain('avg_over_time(probe_success{job="hranilishcha"}[29d])');
    expect(uptimeQuery(0)).toContain('[1d]');
  });

  it('период — сколько реально есть данных, не больше 90 дней', () => {
    expect(periodDaysFromAge(29.9 * 86_400)).toBe(29);
    expect(periodDaysFromAge(400 * 86_400)).toBe(90);
    expect(periodDaysFromAge(3600)).toBe(0);
    expect(periodDaysFromAge(null)).toBeNull();
  });

  it('ответ не по формату — null', () => {
    expect(parseVector({ status: 'error' })).toBeNull();
    expect(parseVector({ status: 'success', data: { resultType: 'matrix', result: [] } })).toBeNull();
    expect(parseVector('мусор')).toBeNull();
  });
});

describe('расчёт статуса', () => {
  const s = (rows: Row[]) => parseVector(vector(rows))!;

  it('все пробы зелёные — operational', () => {
    expect(computeStatus('site', s([['site', 0, 1], ['site', 1, 1]]), s([['site', 0, 1], ['site', 1, 1]]))).toBe(
      'operational',
    );
  });

  it('часть проб падает — degraded', () => {
    expect(computeStatus('site', s([['site', 0, 0], ['site', 1, 1]]), s([['site', 0, 1], ['site', 1, 1]]))).toBe(
      'degraded',
    );
  });

  it('свежесть котировок нарушена при живом сервисе — degraded', () => {
    const now = s([['quotes', 0, 1], ['quotes', 1, 0], ['quotes', 2, 1]]);
    expect(computeStatus('quotes', now, now)).toBe('degraded');
  });

  it('один из сигналов молчит (экспортёр не отдал метрику) — degraded', () => {
    const now = s([['quotes', 0, 1], ['quotes', 2, 1]]);
    expect(computeStatus('quotes', now, now)).toBe('degraded');
  });

  it('все пробы падают все 5 минут — outage', () => {
    const now = s([['terminal', 0, 0], ['terminal', 1, 0, 'gw'], ['terminal', 1, 0, 'web']]);
    expect(computeStatus('terminal', now, now)).toBe('outage');
  });

  it('все упали только что, но в окне 5 минут были живы — ещё degraded', () => {
    const now = s([['cms', 0, 0], ['cms', 1, 0]]);
    const recent = s([['cms', 0, 1], ['cms', 1, 0]]);
    expect(computeStatus('cms', now, recent)).toBe('degraded');
  });

  it('по проверке нет ни одной серии — unknown', () => {
    expect(computeStatus('storage', [], [])).toBe('unknown');
  });

  it('uptime — средняя доля успешных проб по сериям проверки', () => {
    const samples = s([['storage', 0, 1, 'a'], ['storage', 0, 0.99, 'b'], ['site', 0, 0.5]]);
    expect(computeUptime('storage', samples)).toBeCloseTo(0.995, 6);
    expect(computeUptime('cabinet', samples)).toBeNull();
    expect(computeUptime('storage', null)).toBeNull();
  });
});

describe('loadLiveStatus', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetLiveStatusCache();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('без STATUS_PROMETHEUS_URL — not-configured, в сеть не ходит', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await loadLiveStatus({ env: {}, fetchImpl })).toEqual({ state: 'not-configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('считает статусы, uptime и период; кэширует на 30 секунд', async () => {
    const rows = allSignals(1).map((r): Row => (r[0] === 'cabinet' && r[1] === 0 ? [r[0], r[1], 0] : r));
    const uptimeRows = allSignals(1).map((r): Row => (r[0] === 'site' ? [r[0], r[1], 0.9996] : r));
    const { impl, calls } = prometheus({ now: vector(rows), recent: vector(allSignals(1)), uptime: vector(uptimeRows) });
    let t = 1_000_000;
    const result = await loadLiveStatus({ env, fetchImpl: impl, now: () => t });
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.periodDays).toBe(29);
    expect(result.checks.cabinet.status).toBe('degraded');
    expect(result.checks.site).toEqual({ status: 'operational', uptime: 0.9996 });
    const n = calls.length;
    t += STATUS_FRESH_MS - 1;
    await loadLiveStatus({ env, fetchImpl: impl, now: () => t });
    expect(calls.length).toBe(n);
    t += 2;
    await loadLiveStatus({ env, fetchImpl: impl, now: () => t });
    expect(calls.length).toBe(n + 2);
  });

  it('Prometheus недоступен и сохранённого ответа нет — unavailable (не зелёное)', async () => {
    const { impl } = prometheus({ now: new Error('ECONNREFUSED'), recent: new Error('ECONNREFUSED') });
    expect(await loadLiveStatus({ env, fetchImpl: impl, now: () => 1 })).toEqual({ state: 'unavailable' });
  });

  it('HTTP-ошибка Prometheus — unavailable', async () => {
    const impl = vi.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    expect(await loadLiveStatus({ env, fetchImpl: impl, now: () => 1 })).toEqual({ state: 'unavailable' });
  });

  it('кратковременный сбой — последний ответ до 2 минут, потом unavailable', async () => {
    let t = 0;
    const ok = prometheus({ now: vector(allSignals(1)), recent: vector(allSignals(1)) });
    await loadLiveStatus({ env, fetchImpl: ok.impl, now: () => t });
    const down = prometheus({ now: new Error('timeout'), recent: new Error('timeout') });
    t = STATUS_FRESH_MS + 1;
    expect((await loadLiveStatus({ env, fetchImpl: down.impl, now: () => t })).state).toBe('ok');
    t = STATUS_STALE_MS + 1;
    expect((await loadLiveStatus({ env, fetchImpl: down.impl, now: () => t })).state).toBe('unavailable');
  });

  it('uptime не получен — статусы есть, uptime null', async () => {
    const { impl } = prometheus({
      now: vector(allSignals(1)),
      recent: vector(allSignals(1)),
      uptime: { status: 'error', error: 'query timed out' },
    });
    const result = await loadLiveStatus({ env, fetchImpl: impl, now: () => 1 });
    expect(result.state).toBe('ok');
    if (result.state === 'ok') {
      expect(result.checks.site).toEqual({ status: 'operational', uptime: null });
    }
  });
});
