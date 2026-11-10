import type { Queryable } from './db';
import {
  feesRoute,
  parseFeesResponse,
  type Fees,
  type FeesBody,
} from './fees-contract';
import { resolveLeverage, TERMINAL_INSTRUMENT_CLASS, type PortfolioLeverage } from './leverage';
import { AUTH_ERROR_CODES, INTERNAL_AUTH_HEADER, internalAuthValue, type AccountKind } from './terminal-contract';
import type { TerminalUnavailable } from './terminal-money';

/**
 * ТАРИФЫ ПОРТФЕЛЯ (наценка + комиссия) — чтение и доставка в терминал по
 * образцу плеча (`leverage.ts`): изменение тарифа портфеля уходит ВСЕМ
 * клиентам портфеля, fail-closed с откатом применённого.
 */

export type FeesOutcome =
  | { state: 'ok'; fees: Fees; previous: Fees | null; changed: boolean; seq: number | null }
  | { state: 'not-opened' }
  | { state: 'refused'; code: string; status: number }
  | { state: 'unavailable'; reason: TerminalUnavailable };

export interface TerminalFeesClient {
  setFees(userId: string, body: FeesBody, kind: AccountKind): Promise<FeesOutcome>;
}

/** Клиент маршрута `…/fees` (контракт — `fees-contract.ts`). */
export function createTerminalFeesClient(config: {
  baseUrl: string | undefined;
  token: string | undefined;
  tenant: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): TerminalFeesClient {
  const baseUrl = config.baseUrl?.trim().replace(/\/$/, '');
  const token = config.token?.trim();
  const tenant = config.tenant?.trim();
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 8_000;
  return {
    async setFees(userId, body, kind) {
      if (!baseUrl || !token || !tenant) return { state: 'unavailable', reason: 'not-configured' };
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}${feesRoute(tenant, userId, kind)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [INTERNAL_AUTH_HEADER]: internalAuthValue(token) },
          body: JSON.stringify(body),
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
        const parsed = parseFeesResponse(json);
        if (!parsed) return { state: 'unavailable', reason: 'malformed' };
        return { state: 'ok', ...parsed };
      }
      if (res.status >= 400 && res.status < 500) {
        const code = (json as { error?: unknown } | null)?.error;
        if (typeof code !== 'string' || !code) return { state: 'unavailable', reason: 'malformed' };
        if (AUTH_ERROR_CODES.includes(code)) return { state: 'unavailable', reason: 'auth' };
        if (code === 'account_not_opened') return { state: 'not-opened' };
        return { state: 'refused', code, status: res.status };
      }
      return { state: 'unavailable', reason: 'http-error' };
    },
  };
}

export function terminalFeesClientFromEnv(env: NodeJS.ProcessEnv = process.env): TerminalFeesClient {
  return createTerminalFeesClient({
    baseUrl: env.TERMINAL_INTERNAL_URL,
    token: env.INTERNAL_MONEY_TOKEN,
    tenant: env.SITE_SLUG,
  });
}

export interface FeesSyncChange {
  userId: string;
  fees: Fees;
}

export type FeesSyncResult =
  | { ok: true; applied: number; notOpened: number }
  | { ok: false; reason: 'terminalUnavailable'; userId: string; compensationFailed: number }
  | { ok: false; reason: 'terminalRefused'; code: string; userId: string; compensationFailed: number };

const KINDS: readonly AccountKind[] = ['demo', 'real'];

/**
 * Довезти тариф до терминала — оба счёта каждого клиента. Первый отказ или
 * «не знаем» → откат применённого этим вызовом (на тариф, который терминал
 * назвал «до») и `ok: false`; вызывающий откатывает свою транзакцию.
 */
export async function pushFeesToTerminal(
  terminal: TerminalFeesClient,
  changes: readonly FeesSyncChange[],
  meta: { reason: string; operator: string; externalRef?: string },
): Promise<FeesSyncResult> {
  const applied: { userId: string; kind: AccountKind; previous: Fees | null; changed: boolean }[] = [];
  let notOpened = 0;
  const body = (fees: Fees, reason: string): FeesBody => ({
    markup_bps: fees.markupBps,
    commission_bps: fees.commissionBps,
    reason,
    operator: meta.operator,
    ...(meta.externalRef ? { external_ref: meta.externalRef } : {}),
  });

  async function compensate(): Promise<number> {
    let failed = 0;
    for (const a of [...applied].reverse()) {
      if (!a.changed || !a.previous) continue;
      const back = await terminal
        .setFees(a.userId, body(a.previous, `откат: тариф не применён на сайте (${meta.reason})`), a.kind)
        .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const }));
      if (back.state !== 'ok') failed += 1;
    }
    return failed;
  }

  for (const change of changes) {
    for (const kind of KINDS) {
      const out = await terminal
        .setFees(change.userId, body(change.fees, meta.reason), kind)
        .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const }));
      if (out.state === 'ok') {
        applied.push({ userId: change.userId, kind, previous: out.previous, changed: out.changed });
        continue;
      }
      if (out.state === 'not-opened') {
        notOpened += 1;
        continue;
      }
      const compensationFailed = await compensate();
      return out.state === 'refused'
        ? { ok: false, reason: 'terminalRefused', code: out.code, userId: change.userId, compensationFailed }
        : { ok: false, reason: 'terminalUnavailable', userId: change.userId, compensationFailed };
    }
  }
  return { ok: true, applied: applied.length, notOpened };
}

/** Тарифы портфеля, в котором сидит каждый из клиентов (нет строки — портфель по умолчанию). */
export async function readClientFees(db: Queryable, userIds: readonly string[]): Promise<Map<string, Fees>> {
  const out = new Map<string, Fees>();
  if (userIds.length === 0) return out;
  const r = await db.query(
    `SELECT u.id::text AS user_id, p.markup_bps, p.commission_bps
       FROM users u
       LEFT JOIN client_leverage cl ON cl.user_id = u.id
       JOIN leverage_portfolios p ON p.key = COALESCE(cl.portfolio_key,
            (SELECT key FROM leverage_portfolios WHERE is_default ORDER BY key LIMIT 1))
      WHERE u.id::text = ANY($1::text[])`,
    [userIds],
  );
  for (const row of r.rows) {
    out.set(String(row.user_id), { markupBps: Number(row.markup_bps), commissionBps: Number(row.commission_bps) });
  }
  return out;
}

/* ── Условия типов счетов (для /accounts) ─────────────────────────────── */

export interface AccountTypeTerms {
  key: string;
  title: string;
  isDefault: boolean;
  sortOrder: number;
  /** Действующее плечо в терминале (итог закона для класса инструментов терминала). */
  leverage: number;
  baseLeverage: number;
  classOverrides: Record<string, number>;
  markupBps: number;
  commissionBps: number;
  /** Инструменты — текст из админки; `null` — не задан (не выдумываем). */
  instruments: string | null;
  description: string | null;
}

/**
 * Условия типов счетов — ТОЛЬКО из админки (решение владельца №9): плечо,
 * наценка, комиссия, инструменты. Портфели с `is_public = false` не
 * показываются. Для публичной страницы `/accounts` и кабинета.
 */
export async function readAccountTypeTerms(db: Queryable): Promise<AccountTypeTerms[]> {
  const ps = await db.query(
    `SELECT key, title, base_leverage, is_default, sort_order, markup_bps, commission_bps, instruments, description
       FROM leverage_portfolios WHERE is_public ORDER BY sort_order, key`,
  );
  const ov = await db.query(`SELECT portfolio_key, instrument_class, leverage FROM leverage_portfolio_class_overrides`);
  const byKey = new Map<string, Record<string, number>>();
  for (const r of ov.rows) {
    const m = byKey.get(String(r.portfolio_key)) ?? {};
    m[String(r.instrument_class)] = Number(r.leverage);
    byKey.set(String(r.portfolio_key), m);
  }
  return ps.rows.map((r) => {
    const portfolio: PortfolioLeverage = {
      key: String(r.key),
      title: String(r.title),
      baseLeverage: Number(r.base_leverage),
      classOverrides: byKey.get(String(r.key)) ?? {},
    };
    const eff = resolveLeverage({ portfolio, clientOverride: null, instrumentClass: TERMINAL_INSTRUMENT_CLASS });
    return {
      key: portfolio.key,
      title: portfolio.title,
      isDefault: r.is_default === true,
      sortOrder: Number(r.sort_order),
      leverage: eff.leverage,
      baseLeverage: portfolio.baseLeverage,
      classOverrides: { ...portfolio.classOverrides },
      markupBps: Number(r.markup_bps),
      commissionBps: Number(r.commission_bps),
      instruments: r.instruments === null || r.instruments === undefined ? null : String(r.instruments),
      description: r.description === null || r.description === undefined ? null : String(r.description),
    };
  });
}
