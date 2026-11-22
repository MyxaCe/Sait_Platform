import type { AccountKind } from './terminal-contract';

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
