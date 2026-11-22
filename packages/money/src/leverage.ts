import type { Queryable } from './db';
import type { AccountKind, LeverageBody } from './terminal-contract';
import type { LeverageOutcome } from './terminal-money';
import { isLeverageClass, LEVERAGE_CLASSES } from './leverage-classes';

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

export { LEVERAGE_CLASSES, isLeverageClass, type LeverageClass } from './leverage-classes';

export interface TerminalLeverage {
  readonly leverage: number;
  readonly base: number;
  readonly classes: Readonly<Record<string, number>>;
}

export function terminalLeverageOf(
  portfolio: PortfolioLeverage,
  clientOverride: ClientLeverageOverride | null,
): TerminalLeverage {
  const leverage = resolveLeverage({ portfolio, clientOverride, instrumentClass: TERMINAL_INSTRUMENT_CLASS }).leverage;
  if (clientOverride) return { leverage, base: clientOverride.leverage, classes: {} };
  const classes: Record<string, number> = {};
  for (const c of LEVERAGE_CLASSES) {
    if (Object.prototype.hasOwnProperty.call(portfolio.classOverrides, c)) classes[c] = portfolio.classOverrides[c]!;
  }
  return { leverage, base: portfolio.baseLeverage, classes };
}

export function sameTerminalLeverage(a: TerminalLeverage, b: TerminalLeverage): boolean {
  if (a.leverage !== b.leverage || a.base !== b.base) return false;
  const ka = Object.keys(a.classes).sort();
  const kb = Object.keys(b.classes).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a.classes[k] === b.classes[k]);
}

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
  const tables = await readTerminalLeverageTables(db, userIds);
  return new Map([...tables].map(([userId, t]) => [userId, t.leverage]));
}

export async function readTerminalLeverageTables(
  db: Queryable,
  userIds: readonly string[],
): Promise<Map<string, TerminalLeverage>> {
  const out = new Map<string, TerminalLeverage>();
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
    `SELECT portfolio_key, instrument_class, leverage FROM leverage_portfolio_class_overrides`,
  );

  const classByPortfolio = new Map<string, Record<string, number>>();
  for (const r of classRows.rows) {
    const lev = denominator(r.leverage);
    const cls = String(r.instrument_class);
    if (lev === null || !isLeverageClass(cls)) continue;
    const key = String(r.portfolio_key);
    classByPortfolio.set(key, { ...classByPortfolio.get(key), [cls]: lev });
  }
  const byKey = new Map<string, PortfolioLeverage>();
  let defaultKey: string | null = null;
  for (const r of portfolios.rows) {
    const key = String(r.key);
    const base = denominator(r.base_leverage);
    if (base === null) continue;
    byKey.set(key, {
      key,
      title: String(r.title ?? key),
      baseLeverage: base,
      classOverrides: classByPortfolio.get(key) ?? {},
    });
    if (r.is_default === true && (defaultKey === null || key < defaultKey)) defaultKey = key;
  }

  for (const r of clients.rows) {
    const portfolioKey = r.portfolio_key === null || r.portfolio_key === undefined ? defaultKey : String(r.portfolio_key);
    const portfolio = portfolioKey ? byKey.get(portfolioKey) : undefined;
    if (!portfolio) continue;
    const override = denominator(r.override_leverage);
    out.set(
      String(r.user_id),
      terminalLeverageOf(portfolio, override === null ? null : { leverage: override, reason: '', ticket: '' }),
    );
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
  before: TerminalLeverage | null;
  after: TerminalLeverage;
}

export function leverageChanges(
  before: Map<string, TerminalLeverage>,
  after: Map<string, TerminalLeverage>,
): LeverageChange[] {
  const out: LeverageChange[] = [];
  for (const [userId, lev] of after) {
    const was = before.get(userId) ?? null;
    if (!was || !sameTerminalLeverage(was, lev)) out.push({ userId, before: was, after: lev });
  }
  return out;
}

export function leverageBody(t: TerminalLeverage): Pick<LeverageBody, 'leverage' | 'leverage_base' | 'leverage_classes'> {
  return { leverage: t.leverage, leverage_base: t.base, leverage_classes: { ...t.classes } };
}

export interface AppliedLeverage {
  userId: string;
  kind: AccountKind;
  leverage: number;
  previous: number | null;
  previousClasses: Record<string, number> | null;
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
            ...(a.previousClasses ? { leverage_base: a.previous, leverage_classes: a.previousClasses } : {}),
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
            ...leverageBody(change.after),
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
          leverage: change.after.leverage,
          previous: out.previousLeverage,
          previousClasses: out.previousClasses,
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
