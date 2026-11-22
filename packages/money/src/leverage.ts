import type { Queryable } from './db';
import type { AccountKind, LeverageBody } from './terminal-contract';
import type { LeverageOutcome } from './terminal-money';

export type LeverageSource = 'client-override' | 'class-override' | 'portfolio';

export interface PortfolioLeverage {
  readonly key: string;
  readonly title: string;
  readonly baseLeverage: number;
  readonly classOverrides: Readonly<Record<string, number>>;
}

export interface ClientLeverageOverride {
  readonly leverage: number;
  readonly reason: string;
  readonly ticket: string;
}

export interface ResolveInput {
  readonly portfolio: PortfolioLeverage;
  readonly clientOverride: ClientLeverageOverride | null;
  readonly instrumentClass: string | null;
}

export interface ResolvedLeverage {
  readonly leverage: number;
  readonly source: LeverageSource;
  readonly instrumentClass: string | null;
  readonly portfolioKey: string;
}

export function resolveLeverage(input: ResolveInput): ResolvedLeverage {
  const { portfolio, clientOverride, instrumentClass } = input;

  if (clientOverride) {
    return {
      leverage: clientOverride.leverage,
      source: 'client-override',
      instrumentClass: null,
      portfolioKey: portfolio.key,
    };
  }

  if (instrumentClass && Object.prototype.hasOwnProperty.call(portfolio.classOverrides, instrumentClass)) {
    return {
      leverage: portfolio.classOverrides[instrumentClass]!,
      source: 'class-override',
      instrumentClass,
      portfolioKey: portfolio.key,
    };
  }

  return {
    leverage: portfolio.baseLeverage,
    source: 'portfolio',
    instrumentClass: null,
    portfolioKey: portfolio.key,
  };
}

export const TERMINAL_INSTRUMENT_CLASS = 'crypto';

export const MIN_TERMINAL_LEVERAGE = 1;
export const MAX_TERMINAL_LEVERAGE = 1000;

function denominator(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function readTerminalLeverage(
  db: Queryable,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;

  const clients = await db.query(
    `SELECT u.id::text AS user_id, cl.portfolio_key, cl.override_leverage
       FROM users u
       LEFT JOIN client_leverage cl ON cl.user_id = u.id
      WHERE u.id::text = ANY($1::text[])`,
    [userIds],
  );
  const portfolios = await db.query(`SELECT key, title, base_leverage, is_default FROM leverage_portfolios`);
  const classRows = await db.query(
    `SELECT portfolio_key, leverage FROM leverage_portfolio_class_overrides WHERE instrument_class = $1`,
    [TERMINAL_INSTRUMENT_CLASS],
  );

  const classByPortfolio = new Map<string, number>();
  for (const r of classRows.rows) {
    const lev = denominator(r.leverage);
    if (lev !== null) classByPortfolio.set(String(r.portfolio_key), lev);
  }
  const byKey = new Map<string, PortfolioLeverage>();
  let defaultKey: string | null = null;
  for (const r of portfolios.rows) {
    const key = String(r.key);
    const base = denominator(r.base_leverage);
    if (base === null) continue;
    const cls = classByPortfolio.get(key);
    byKey.set(key, {
      key,
      title: String(r.title ?? key),
      baseLeverage: base,
      classOverrides: cls === undefined ? {} : { [TERMINAL_INSTRUMENT_CLASS]: cls },
    });
    if (r.is_default === true && (defaultKey === null || key < defaultKey)) defaultKey = key;
  }

  for (const r of clients.rows) {
    const portfolioKey = r.portfolio_key === null || r.portfolio_key === undefined ? defaultKey : String(r.portfolio_key);
    const portfolio = portfolioKey ? byKey.get(portfolioKey) : undefined;
    if (!portfolio) continue;
    const override = denominator(r.override_leverage);
    const resolved = resolveLeverage({
      portfolio,
      clientOverride: override === null ? null : { leverage: override, reason: '', ticket: '' },
      instrumentClass: TERMINAL_INSTRUMENT_CLASS,
    });
    out.set(String(r.user_id), resolved.leverage);
  }
  return out;
}

export async function clientsOfPortfolio(db: Queryable, portfolioKey: string): Promise<string[]> {
  const res = await db.query(
    `SELECT u.id::text AS user_id
       FROM users u
       LEFT JOIN client_leverage cl ON cl.user_id = u.id
      WHERE cl.portfolio_key = $1
         OR (cl.user_id IS NULL
             AND EXISTS (SELECT 1 FROM leverage_portfolios p WHERE p.key = $1 AND p.is_default))
      ORDER BY u.id`,
    [portfolioKey],
  );
  return res.rows.map((r) => String(r.user_id));
}

export interface LeverageChange {
  userId: string;
  before: number | null;
  after: number;
}

export function leverageChanges(before: Map<string, number>, after: Map<string, number>): LeverageChange[] {
  const out: LeverageChange[] = [];
  for (const [userId, lev] of after) {
    const was = before.get(userId) ?? null;
    if (was !== lev) out.push({ userId, before: was, after: lev });
  }
  return out;
}

export interface AppliedLeverage {
  userId: string;
  kind: AccountKind;
  leverage: number;
  previous: number | null;
  changed: boolean;
  seq: number | null;
}

export type LeverageSyncResult =
  | { ok: true; applied: AppliedLeverage[]; notOpened: number }
  | { ok: false; reason: 'terminalUnavailable'; userId: string; compensationFailed: number }
  | { ok: false; reason: 'terminalRefused'; code: string; userId: string; compensationFailed: number };

export interface TerminalLeverageClient {
  setLeverage(userId: string, body: LeverageBody, kind: AccountKind): Promise<LeverageOutcome>;
}

const KINDS: readonly AccountKind[] = ['demo', 'real'];

export async function pushLeverageToTerminal(
  terminal: TerminalLeverageClient,
  changes: readonly LeverageChange[],
  meta: { reason: string; operator: string; externalRef?: string },
): Promise<LeverageSyncResult> {
  const applied: AppliedLeverage[] = [];
  let notOpened = 0;

  async function compensate(): Promise<number> {
    let failed = 0;
    for (const a of [...applied].reverse()) {
      if (!a.changed || a.previous === null) continue;
      const back = await terminal
        .setLeverage(
          a.userId,
          {
            leverage: a.previous,
            reason: `откат: изменение плеча не применено на сайте (${meta.reason})`,
            operator: meta.operator,
            ...(meta.externalRef ? { external_ref: meta.externalRef } : {}),
          },
          a.kind,
        )
        .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const }));
      if (back.state !== 'ok') failed += 1;
    }
    return failed;
  }

  for (const change of changes) {
    for (const kind of KINDS) {
      const out = await terminal
        .setLeverage(
          change.userId,
          {
            leverage: change.after,
            reason: meta.reason,
            operator: meta.operator,
            ...(meta.externalRef ? { external_ref: meta.externalRef } : {}),
          },
          kind,
        )
        .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const }));
      if (out.state === 'ok') {
        applied.push({
          userId: change.userId,
          kind,
          leverage: change.after,
          previous: out.previousLeverage,
          changed: out.changed,
          seq: out.seq,
        });
        continue;
      }
      if (out.state === 'not-opened') {
        notOpened += 1;
        continue;
      }
      const compensationFailed = await compensate();
      if (out.state === 'refused') {
        return { ok: false, reason: 'terminalRefused', code: out.code, userId: change.userId, compensationFailed };
      }
      return { ok: false, reason: 'terminalUnavailable', userId: change.userId, compensationFailed };
    }
  }
  return { ok: true, applied, notOpened };
}
