import { getPool, type Queryable } from '../db';

export const KYC_SLA_HOURS = 48;

export function isKycOverdue(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() > KYC_SLA_HOURS * 3_600_000;
}

export interface KycQueueStats {
  resubmit: number;
}

export async function getKycQueueStats(db: Queryable = getPool()): Promise<KycQueueStats> {
  const r = await db.query(
    `SELECT count(*)::int AS resubmit FROM client_verification WHERE state = 'resubmit_requested'`,
  );
  const row = r.rows[0] ?? {};
  return { resubmit: Number(row.resubmit ?? 0) };
}
