import { getPool, type Queryable } from '../db';

/**
 * Сводка очереди KYC для шапки `/kyc` (редизайн, фаза 2) — только чтение.
 *
 * SLA очереди: заявка дольше `KYC_SLA_HOURS` — «просрочена» (подсветка возраста).
 * Тот же порог, что на дашборде (`app/(protected)/page.tsx`); при смене — менять
 * в обоих местах (кандидат в общий модуль).
 */
export const KYC_SLA_HOURS = 48;

export function isKycOverdue(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() > KYC_SLA_HOURS * 3_600_000;
}

export interface KycQueueStats {
  /** Ждут клиента: запрошена переподача. */
  resubmit: number;
}

export async function getKycQueueStats(db: Queryable = getPool()): Promise<KycQueueStats> {
  const r = await db.query(
    `SELECT count(*)::int AS resubmit FROM client_verification WHERE state = 'resubmit_requested'`,
  );
  const row = r.rows[0] ?? {};
  return { resubmit: Number(row.resubmit ?? 0) };
}
