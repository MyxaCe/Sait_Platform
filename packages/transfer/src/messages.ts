import type { Queryable } from '@broker/money';
import type { MessageKind } from './envelope';

/**
 * Содержимое межплатформенных сообщений (контракт v1).
 *
 * Пакет — МИНИМУМ по согласию клиента: ФИО, email, страна, язык, статус и
 * дата KYC источника, хеш доказательства инициативы, время и версия
 * согласия. Без балансов, без документов KYC, без данных оператора.
 */

export interface PackageData {
  number: string;
  sourcePlatform: string;
  client: { fullName: string; email: string; country: string | null; locale: 'ru' | 'en' };
  sourceKyc: { state: string; at: string | null };
  evidence: { kind: 'support_ticket'; sha256: string };
  consent: { at: string; textVersion: string; textSha256: string; messageSha256: string };
  initiatedAt: string;
}

export interface RevokeData {
  number: string;
  basis: string;
  revokedAt: string;
}

export type StatusEvent = 'invited' | 'registered' | 'kyc_passed' | 'expired' | 'revoke_applied';
export const STATUS_EVENTS: readonly StatusEvent[] = ['invited', 'registered', 'kyc_passed', 'expired', 'revoke_applied'];

export interface StatusData {
  number: string;
  event: StatusEvent;
  at: string;
  detail?: {
    stage?: 'before_registration' | 'after_registration' | 'unknown_transfer';
    inviteRevoked?: boolean;
    accountFrozen?: boolean;
    fundsOnTarget?: boolean;
  };
}

/** Ключ идемпотентности факта: повторная доставка того же факта — «дубликат». */
export function dedupeKey(transferId: string, kind: MessageKind, event?: string): string {
  return `${transferId}:${kind}${event ? `:${event}` : ''}`;
}

/** Поставить сообщение в очередь доставки (та же транзакция, что и факт). */
export async function enqueueMessage(
  tx: Queryable,
  m: { transferId: string; to: string; kind: MessageKind; data: object; event?: string },
): Promise<string | null> {
  const r = await tx.query(
    `INSERT INTO platform_transfer_outbox (transfer_id, to_platform, kind, data, dedupe_key)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [m.transferId, m.to, m.kind, JSON.stringify(m.data), dedupeKey(m.transferId, m.kind, m.event)],
  );
  return r.rows[0] ? String(r.rows[0].id) : null;
}
