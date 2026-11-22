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
  leverage: (tenant: string, userId: string, kind: AccountKind) => `${base(tenant, userId)}/${kind}/leverage`,
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

export interface LeverageBody {
  leverage: number;
  reason: string;
  operator: string;
  external_ref?: string;
}

export interface LeverageResult {
  leverage: number;
  previousLeverage: number | null;
  changed: boolean;
  seq: number | null;
}

export function parseLeverageResponse(body: unknown): LeverageResult | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const lev = Number(b.leverage);
  if (!Number.isInteger(lev) || lev < 1) return null;
  const prev = numOrNull(b.previous_leverage);
  return {
    leverage: lev,
    previousLeverage: prev,
    changed: b.changed === true,
    seq: numOrNull(b.seq),
  };
}

export interface MoneyMoveResult {
  balanceMinor: number;
  freeMarginMinor: number | null;
  seq: number;
  replayed: boolean;
  accountId: string | null;
}

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
  leverage: number | null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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
      leverage: numOrNull(a.leverage),
    });
  }
  return out;
}

export const AUTH_ERROR_CODES: readonly string[] = ['missing_internal_token', 'invalid_internal_token'];

export const KNOWN_REFUSALS = [
  'insufficient_free_margin',
  'account_frozen',
  'account_not_opened',
  'account_quarantined',
  'external_ref_conflict',
  'invalid_amount',
] as const;
export type KnownRefusal = (typeof KNOWN_REFUSALS)[number];

export const externalRef = {
  deposit: (txHash: string) => `tron:${txHash}`,
  withdraw: (withdrawalId: string) => `wd:${withdrawalId}`,
  withdrawRefund: (withdrawalId: string) => `wd-refund:${withdrawalId}`,
};
