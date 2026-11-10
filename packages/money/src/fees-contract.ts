/**
 * КОНТРАКТ маршрута тарифов счёта терминала — ВЕСЬ в этом файле.
 *
 * Статус: ТОЧНЫЙ (терминал, ветка `demo-fees`, гейт зелёный, 10.11). Правка
 * контракта — только здесь; вызывающие (`fees.ts`, админка) опираются на
 * типы отсюда.
 *
 *   POST /internal/sites/{tenant}/users/{sub}/{demo|real}/fees
 *        заголовок X-Internal-Token
 *        тело  { markup_bps, commission_bps — ОБЕ обязательны, целые 0..500,
 *                reason, operator (или initiator), external_ref? }
 *        200   { tenant, sub, account_kind, account_id, markup_bps, commission_bps,
 *                previous_markup_bps, previous_commission_bps, changed, seq }
 *                — повтор того же тарифа: changed:false, тот же seq.
 *        404 account_not_opened — счёта нет: НЕ ошибка, тариф придёт SSO-claim'ом
 *                (`markup_bps`, `commission_bps`) при первом входе.
 *        404 unknown_account_kind; 404 БЕЗ кода — секрет/маршрут не задан →
 *                «недоступно» (fail-closed, откат).
 *        401/403 — токен (ошибка доступа → «недоступно»).
 *        400 invalid_fees / missing_reason / missing_operator /
 *                invalid_external_ref / bad_request.
 *        503 identity_store_unavailable — исход неизвестен.
 *   GET …/accounts и /account отдают `markup_bps`, `commission_bps`.
 *
 * Смысл ставок (решение владельца №6): наценка — к цене исполнения (спред
 * поверх рынка), комиссия — от нотионала. 1 б.п. = 0,01 %.
 * Событие `trade.executed` (на ЗАКРЫТИИ, числа за всю сделку): `commissionMinor`,
 * `markupMinor` (целые), `marketPrice` (может отсутствовать у старых сделок);
 * `realizedPnlMinor` — GROSS. Доход платформы = commissionMinor + markupMinor.
 */

import type { AccountKind } from './terminal-contract';

/** Верхняя граница ставки у терминала (0..500 б.п. = 0..5 %). */
export const MAX_FEE_BPS = 500;

const base = (tenant: string, userId: string) =>
  `/internal/sites/${encodeURIComponent(tenant)}/users/${encodeURIComponent(userId)}`;

export const feesRoute = (tenant: string, userId: string, kind: AccountKind) => `${base(tenant, userId)}/${kind}/fees`;

export interface Fees {
  markupBps: number;
  commissionBps: number;
}

export interface FeesBody {
  markup_bps: number;
  commission_bps: number;
  reason: string;
  operator: string;
  external_ref?: string;
}

export interface FeesResult {
  fees: Fees;
  previous: Fees | null;
  changed: boolean;
  seq: number | null;
}

const isBps = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_FEE_BPS;

export function isValidFees(f: Fees): boolean {
  return isBps(f.markupBps) && isBps(f.commissionBps);
}

/** Разбор ответа `…/fees`. `null` — тело не по контракту. */
export function parseFeesResponse(body: unknown): FeesResult | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const m = Number(b.markup_bps);
  const c = Number(b.commission_bps);
  if (!isBps(m) || !isBps(c)) return null;
  const pm = b.previous_markup_bps === undefined || b.previous_markup_bps === null ? null : Number(b.previous_markup_bps);
  const pc = b.previous_commission_bps === undefined || b.previous_commission_bps === null ? null : Number(b.previous_commission_bps);
  const seq = b.seq === undefined || b.seq === null ? null : Number(b.seq);
  return {
    fees: { markupBps: m, commissionBps: c },
    previous: pm !== null && pc !== null && isBps(pm) && isBps(pc) ? { markupBps: pm, commissionBps: pc } : null,
    changed: b.changed === true,
    seq: seq !== null && Number.isFinite(seq) ? seq : null,
  };
}
