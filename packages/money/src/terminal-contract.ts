/**
 * КОНТРАКТ внутренних денежных маршрутов терминала — ВЕСЬ в этом файле.
 *
 * Статус: ТОЧНЫЙ (терминал, ветка `demo-money`, 09.11). Правка контракта —
 * только здесь; клиент (`terminal-money.ts`) и вызывающие опираются на типы
 * отсюда.
 *
 * Адрес: `TERMINAL_INTERNAL_URL` (внутренняя сеть, напр.
 * `http://broker-terminal-gateway:8080`; снаружи через nginx /internal* — 404).
 * Заголовки: `X-Internal-Token: <INTERNAL_MONEY_TOKEN>`, JSON.
 * `{tenant}` = слаг сайта (SITE_SLUG), `{user_id}` = тот же sub, что в SSO.
 *
 *   POST /internal/sites/{tenant}/users/{user_id}/real/deposit
 *   POST /internal/sites/{tenant}/users/{user_id}/real/withdraw
 *        тело  { amount_minor, currency:"USD", external_ref (1–200), initiator, reason }
 *        200   { operation, tenant, sub, account_kind:"real", account_id, external_ref,
 *                amount_minor, currency, balance_minor, free_margin_minor, seq, replayed }
 *        Повтор ref → 200, replayed:true, seq первой проводки (идемпотентно).
 *        Реальный счёт заводится первым deposit (с 0).
 *        withdraw: 404 account_not_opened, 403 account_frozen,
 *                  409 insufficient_free_margin { requested_minor, free_margin_minor, … }.
 *        Отказанный ref не сгорает (можно повторить тем же ref).
 *   POST /internal/sites/{tenant}/users/{user_id}/{demo|real}/trading-freeze
 *        тело  { frozen, reason, operator, external_ref? }
 *        200   { tenant, sub, account_kind, account_id, frozen, changed, seq }
 *   GET  /internal/sites/{tenant}/users/{user_id}/accounts
 *        200   { tenant, sub, accounts: [{ account_kind, account_id, opened, currency,
 *                balance_minor, equity_minor, free_margin_minor, used_margin_minor,
 *                open_positions, trading_frozen }] }  (денежные поля могут быть null)
 *
 * Прочие отказы: 400 bad_request/invalid_amount/unsupported_currency/
 * invalid_external_ref/missing_initiator/missing_operator/missing_reason,
 * 409 external_ref_conflict, 423 account_quarantined, 422 journal_divergence/
 * invariant_violated. Сеть/5xx (503 identity_store_unavailable, 500
 * journal_not_committed) — исход неизвестен: в финальный статус не переводим,
 * повтор тем же ref безопасен.
 *
 * Ошибки ДОСТУПА (нет env у шлюза → 404 без кода; 401 missing_internal_token;
 * 403 invalid_internal_token) — это наша неверная настройка, а не решение по
 * деньгам: классифицируются как «недоступно» (`AUTH_ERROR_CODES`), чтобы
 * заявка клиента не стала «отклонено» из-за конфигурации.
 */

export const INTERNAL_AUTH_HEADER = 'x-internal-token';
export const internalAuthValue = (token: string): string => token;

export const TERMINAL_CURRENCY = 'USD';

export type AccountKind = 'demo' | 'real';

const base = (tenant: string, userId: string) =>
  `/internal/sites/${encodeURIComponent(tenant)}/users/${encodeURIComponent(userId)}`;

export const routes = {
  deposit: (tenant: string, userId: string) => `${base(tenant, userId)}/real/deposit`,
  withdraw: (tenant: string, userId: string) => `${base(tenant, userId)}/real/withdraw`,
  tradingFreeze: (tenant: string, userId: string, kind: AccountKind = 'real') =>
    `${base(tenant, userId)}/${kind}/trading-freeze`,
  accounts: (tenant: string, userId: string) => `${base(tenant, userId)}/accounts`,
};

export interface MoneyMoveBody {
  amount_minor: number;
  currency: typeof TERMINAL_CURRENCY;
  external_ref: string;
  initiator: string;
  reason: string;
}

export interface FreezeBody {
  frozen: boolean;
  reason: string;
  operator: string;
  external_ref?: string;
}

export interface MoneyMoveResult {
  balanceMinor: number;
  freeMarginMinor: number | null;
  seq: number;
  replayed: boolean;
  accountId: string | null;
}

/** Разбор ответа движения денег. `null` — тело не по контракту. */
export function parseMoneyMoveResponse(body: unknown): MoneyMoveResult | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const balance = Number(b.balance_minor);
  const seq = Number(b.seq);
  if (b.balance_minor === null || !Number.isFinite(balance) || !Number.isFinite(seq)) return null;
  const free = b.free_margin_minor === null || b.free_margin_minor === undefined ? null : Number(b.free_margin_minor);
  return {
    balanceMinor: balance,
    freeMarginMinor: free !== null && Number.isFinite(free) ? free : null,
    seq,
    replayed: b.replayed === true,
    accountId: typeof b.account_id === 'string' ? b.account_id : null,
  };
}

export interface TerminalAccount {
  kind: AccountKind;
  accountId: string | null;
  opened: boolean;
  currency: string;
  balanceMinor: number | null;
  equityMinor: number | null;
  freeMarginMinor: number | null;
  usedMarginMinor: number | null;
  openPositions: number | null;
  tradingFrozen: boolean;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Разбор `GET …/accounts`. Неизвестный kind отбрасывается; не тот формат → null. */
export function parseAccountsResponse(body: unknown): TerminalAccount[] | null {
  const list = (body as { accounts?: unknown } | null)?.accounts;
  if (!Array.isArray(list)) return null;
  const out: TerminalAccount[] = [];
  for (const raw of list) {
    const a = raw as Record<string, unknown>;
    if (a?.account_kind !== 'demo' && a?.account_kind !== 'real') continue;
    out.push({
      kind: a.account_kind,
      accountId: typeof a.account_id === 'string' ? a.account_id : null,
      opened: a.opened === true,
      currency: typeof a.currency === 'string' ? a.currency : 'USD',
      balanceMinor: numOrNull(a.balance_minor),
      equityMinor: numOrNull(a.equity_minor),
      freeMarginMinor: numOrNull(a.free_margin_minor),
      usedMarginMinor: numOrNull(a.used_margin_minor),
      openPositions: numOrNull(a.open_positions),
      tradingFrozen: a.trading_frozen === true,
    });
  }
  return out;
}

/** Ошибки доступа к маршрутам — это настройка, не отказ по деньгам. */
export const AUTH_ERROR_CODES: readonly string[] = ['missing_internal_token', 'invalid_internal_token'];

/** Известные отказы по существу (показываются человеку текстом). */
export const KNOWN_REFUSALS = [
  'insufficient_free_margin',
  'account_frozen',
  'account_not_opened',
  'account_quarantined',
  'external_ref_conflict',
  'invalid_amount',
] as const;
export type KnownRefusal = (typeof KNOWN_REFUSALS)[number];

/** Внешние ссылки операций — одна форма на всю платформу. */
export const externalRef = {
  deposit: (txHash: string) => `tron:${txHash}`,
  withdraw: (withdrawalId: string) => `wd:${withdrawalId}`,
  withdrawRefund: (withdrawalId: string) => `wd-refund:${withdrawalId}`,
};
