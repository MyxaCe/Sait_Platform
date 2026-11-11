import type { Queryable } from '@broker/money';
import { iso } from './common';
import { managerAlert } from './policy';
import type { TransferStatus } from './source';

/** Чтение для экранов: «Переводы клиентов», карточка клиента, дашборд, «Операторы». */

export interface OutgoingTransferRow {
  id: string;
  number: string;
  userId: string;
  clientName: string;
  clientEmail: string;
  clientCountry: string | null;
  targetPlatform: string;
  targetName: string | null;
  status: TransferStatus;
  deliveryState: string;
  deliveryError: string | null;
  initiatorId: string;
  initiatorName: string;
  ticketId: string;
  ticketNumber: number;
  basis: string;
  hints: string[];
  createdAt: string;
  deliveredAt: string | null;
  targetInvitedAt: string | null;
  targetRegisteredAt: string | null;
  targetKycPassedAt: string | null;
  sourceClosedAt: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  revokeBasis: string | null;
  revokeStage: string | null;
  revokeAppliedAt: string | null;
  revokeTargetDetail: Record<string, unknown> | null;
  restoreState: string;
  adminSeenAt: string | null;
}

const OUT_SELECT = `
  SELECT p.*, u.full_name AS client_name, u.email AS client_email, u.country AS client_country,
         g.name AS target_name, o.display_name AS initiator_name, r.display_name AS revoked_by_name,
         t.number AS ticket_number
    FROM platform_transfers p
    JOIN users u ON u.id = p.user_id
    JOIN operators o ON o.id = p.initiator_id
    JOIN support_tickets t ON t.id = p.evidence_ticket_id
    LEFT JOIN operators r ON r.id = p.revoked_by
    LEFT JOIN group_platforms g ON g.slug = p.target_platform`;

function outRow(r: Record<string, unknown>): OutgoingTransferRow {
  const flags = typeof r.jurisdiction_flags === 'string' ? JSON.parse(r.jurisdiction_flags) : r.jurisdiction_flags;
  const detail = typeof r.revoke_target_detail === 'string' ? JSON.parse(r.revoke_target_detail) : r.revoke_target_detail;
  return {
    id: String(r.id),
    number: String(r.number),
    userId: String(r.user_id),
    clientName: String(r.client_name),
    clientEmail: String(r.client_email),
    clientCountry: (r.client_country as string | null) ?? null,
    targetPlatform: String(r.target_platform),
    targetName: (r.target_name as string | null) ?? null,
    status: r.status as TransferStatus,
    deliveryState: String(r.delivery_state),
    deliveryError: (r.delivery_error as string | null) ?? null,
    initiatorId: String(r.initiator_id),
    initiatorName: String(r.initiator_name),
    ticketId: String(r.evidence_ticket_id),
    ticketNumber: Number(r.ticket_number),
    basis: String(r.basis),
    hints: Array.isArray(flags) ? flags.map(String) : [],
    createdAt: iso(r.created_at)!,
    deliveredAt: iso(r.delivered_at),
    targetInvitedAt: iso(r.target_invited_at),
    targetRegisteredAt: iso(r.target_registered_at),
    targetKycPassedAt: iso(r.target_kyc_passed_at),
    sourceClosedAt: iso(r.source_closed_at),
    revokedAt: iso(r.revoked_at),
    revokedByName: (r.revoked_by_name as string | null) ?? null,
    revokeBasis: (r.revoke_basis as string | null) ?? null,
    revokeStage: (r.revoke_stage as string | null) ?? null,
    revokeAppliedAt: iso(r.revoke_applied_at),
    revokeTargetDetail: (detail as Record<string, unknown> | null) ?? null,
    restoreState: String(r.restore_state),
    adminSeenAt: iso(r.admin_seen_at),
  };
}

export async function listOutgoingTransfers(
  db: Queryable,
  filter: { initiatorId?: string; status?: string; limit?: number } = {},
): Promise<OutgoingTransferRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.initiatorId) {
    params.push(filter.initiatorId);
    where.push(`p.initiator_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`p.status = $${params.length}`);
  }
  params.push(filter.limit ?? 200);
  const r = await db.query(
    `${OUT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows.map(outRow);
}

export async function getOutgoingTransfer(db: Queryable, id: string): Promise<OutgoingTransferRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db.query(`${OUT_SELECT} WHERE p.id = $1`, [id]);
  return r.rows[0] ? outRow(r.rows[0]) : null;
}

export async function getClientTransfers(db: Queryable, userId: string): Promise<OutgoingTransferRow[]> {
  const r = await db.query(`${OUT_SELECT} WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 20`, [userId]);
  return r.rows.map(outRow);
}

export interface ChannelMessageRow {
  id: string;
  kind: string;
  toPlatform: string;
  state: string;
  attempts: number;
  lastError: string | null;
  responseCode: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  event: string | null;
}

export async function listTransferMessages(db: Queryable, transferId: string): Promise<ChannelMessageRow[]> {
  const r = await db.query(
    `SELECT id, kind, to_platform, state, attempts, last_error, response_code, next_attempt_at, delivered_at, created_at, data
       FROM platform_transfer_outbox WHERE transfer_id = $1 ORDER BY created_at`,
    [transferId],
  );
  return r.rows.map((x) => {
    const data = (typeof x.data === 'string' ? JSON.parse(x.data) : x.data) as { event?: string } | null;
    return {
      id: String(x.id),
      kind: String(x.kind),
      toPlatform: String(x.to_platform),
      state: String(x.state),
      attempts: Number(x.attempts),
      lastError: (x.last_error as string | null) ?? null,
      responseCode: (x.response_code as string | null) ?? null,
      nextAttemptAt: iso(x.next_attempt_at),
      deliveredAt: iso(x.delivered_at),
      createdAt: iso(x.created_at)!,
      event: data?.event ?? null,
    };
  });
}

export interface InboundTransferRow {
  transferId: string;
  number: string;
  sourcePlatform: string;
  sourceName: string | null;
  fullName: string;
  email: string;
  country: string | null;
  locale: string;
  sourceKycState: string | null;
  status: string;
  inviteExpiresAt: string;
  inviteMailStatus: string | null;
  invitedAt: string | null;
  registeredUserId: string | null;
  registeredAt: string | null;
  kycPassedAt: string | null;
  revokedAt: string | null;
  revokeBasis: string | null;
  freezeState: string;
  refundTask: string;
  refundTaskNote: string | null;
  receivedAt: string;
  packageSha256: string;
  evidenceSha256: string;
  consentAt: string;
  consentTextVersion: string;
}

export async function listInboundTransfers(db: Queryable, limit = 200): Promise<InboundTransferRow[]> {
  const r = await db.query(
    `SELECT i.*, g.name AS source_name, m.status AS mail_status
       FROM platform_transfers_inbound i
       LEFT JOIN group_platforms g ON g.slug = i.source_platform
       LEFT JOIN outbound_mail m ON m.id = i.invite_mail_id
      ORDER BY i.received_at DESC LIMIT $1`,
    [limit],
  );
  return r.rows.map((x) => ({
    transferId: String(x.transfer_id),
    number: String(x.number),
    sourcePlatform: String(x.source_platform),
    sourceName: (x.source_name as string | null) ?? null,
    fullName: String(x.full_name),
    email: String(x.email),
    country: (x.country as string | null) ?? null,
    locale: String(x.locale),
    sourceKycState: (x.source_kyc_state as string | null) ?? null,
    status: String(x.status),
    inviteExpiresAt: iso(x.invite_expires_at)!,
    inviteMailStatus: (x.mail_status as string | null) ?? null,
    invitedAt: iso(x.invited_at),
    registeredUserId: x.registered_user_id ? String(x.registered_user_id) : null,
    registeredAt: iso(x.registered_at),
    kycPassedAt: iso(x.kyc_passed_at),
    revokedAt: iso(x.revoked_at),
    revokeBasis: (x.revoke_basis as string | null) ?? null,
    freezeState: String(x.freeze_state),
    refundTask: String(x.refund_task),
    refundTaskNote: (x.refund_task_note as string | null) ?? null,
    receivedAt: iso(x.received_at)!,
    packageSha256: String(x.package_sha256),
    evidenceSha256: String(x.evidence_sha256),
    consentAt: iso(x.consent_at)!,
    consentTextVersion: String(x.consent_text_version),
  }));
}

export async function getInboundForUser(db: Queryable, userId: string): Promise<InboundTransferRow | null> {
  const all = await db.query(`SELECT transfer_id FROM platform_transfers_inbound WHERE registered_user_id = $1`, [userId]);
  if (!all.rows[0]) return null;
  const list = await listInboundTransfers(db, 500);
  return list.find((x) => x.transferId === String(all.rows[0]!.transfer_id)) ?? null;
}

/** Уведомление admin: непросмотренные исходящие и входящие. */
export async function unseenTransferCounts(db: Queryable): Promise<{ outgoing: number; inbound: number; refundTasks: number }> {
  const r = await db.query(
    `SELECT (SELECT count(*)::int FROM platform_transfers WHERE admin_seen_at IS NULL) AS outgoing,
            (SELECT count(*)::int FROM platform_transfers_inbound WHERE admin_seen_at IS NULL) AS inbound,
            (SELECT count(*)::int FROM platform_transfers_inbound WHERE refund_task = 'open') AS refund_tasks`,
  );
  const x = r.rows[0] ?? {};
  return { outgoing: Number(x.outgoing ?? 0), inbound: Number(x.inbound ?? 0), refundTasks: Number(x.refund_tasks ?? 0) };
}

export interface ManagerReportRow {
  operatorId: string;
  name: string;
  total30d: number;
  revoked30d: number;
  revokedAllTime: number;
  alert: 'absolute' | 'aboveMedian' | null;
}

/** Отчёт по менеджерам за 30 дней + алерт на аномалию (информационно). */
export async function managerTransferReport(db: Queryable, now = new Date()): Promise<ManagerReportRow[]> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const r = await db.query(
    `SELECT o.id, o.display_name,
            count(p.id) FILTER (WHERE p.created_at > $1)::int AS total30,
            count(p.id) FILTER (WHERE p.created_at > $1 AND p.status = 'revoked')::int AS revoked30,
            count(p.id) FILTER (WHERE p.status = 'revoked')::int AS revoked_all
       FROM operators o
       LEFT JOIN platform_transfers p ON p.initiator_id = o.id
      WHERE o.is_client_manager OR EXISTS (SELECT 1 FROM platform_transfers x WHERE x.initiator_id = o.id)
      GROUP BY o.id, o.display_name
      ORDER BY total30 DESC, o.display_name`,
    [since],
  );
  const counts = r.rows.map((x) => Number(x.total30));
  return r.rows.map((x) => ({
    operatorId: String(x.id),
    name: String(x.display_name),
    total30d: Number(x.total30),
    revoked30d: Number(x.revoked30),
    revokedAllTime: Number(x.revoked_all),
    alert: managerAlert(Number(x.total30), counts),
  }));
}

/** Счётчик возвращённых переводов по операторам (экран «Операторы»). */
export async function revokedCountsByInitiator(db: Queryable): Promise<Map<string, number>> {
  const r = await db.query(
    `SELECT initiator_id, count(*)::int AS n FROM platform_transfers WHERE status = 'revoked' GROUP BY initiator_id`,
  );
  return new Map(r.rows.map((x) => [String(x.initiator_id), Number(x.n)]));
}
