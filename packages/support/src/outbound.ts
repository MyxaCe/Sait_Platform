import type { Queryable } from '@broker/money';
import { normalizeMessageId } from './text';

/**
 * Очередь исходящих писем (`outbound_mail`). Письмо пишется в той же
 * транзакции, что и его причина (ответ оператора, сброс пароля) — дух
 * ADR-018; отправляет отдельный воркер (`apps/support-mail`) через SMTP
 * cPanel, отмечая `sent` или `failed` с повтором по нарастающей паузе.
 * Оператор видит состояние доставки у своего ответа.
 */

export type MailPurpose =
  | 'support_reply'
  | 'support_ack'
  | 'password_reset'
  | 'email_verify'
  // ── Перевод на другую платформу группы (ветка client-transfer): приглашение
  //    цели (одноразовая ссылка) и уведомление о возврате перевода. ──
  | 'transfer_invite'
  | 'transfer_notice';
export type MailStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

/** Письма с одноразовыми ссылками — тело стирается после отправки. */
export const SECRET_BODY_PURPOSES: readonly MailPurpose[] = ['password_reset', 'email_verify', 'transfer_invite'];

/** Системные письма (не переписка): уходят всегда, даже когда почтовый канал поддержки выключен. */
export const SYSTEM_MAIL_PURPOSES: readonly MailPurpose[] = [
  'password_reset',
  'email_verify',
  'transfer_invite',
  'transfer_notice',
];

export interface EnqueueInput {
  purpose: MailPurpose;
  to: string;
  subject: string;
  bodyText: string;
  ticketId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: readonly string[];
  expiresAt?: Date | null;
}

export async function enqueueMail(tx: Queryable, m: EnqueueInput): Promise<string> {
  const r = await tx.query(
    `INSERT INTO outbound_mail (purpose, ticket_id, message_id, to_address, subject, body_text, in_reply_to,
       references_list, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      m.purpose,
      m.ticketId ?? null,
      m.messageId ?? null,
      m.to.trim(),
      m.subject,
      m.bodyText,
      normalizeMessageId(m.inReplyTo),
      (m.references ?? []).map((x) => normalizeMessageId(x)).filter((x): x is string => x !== null),
      m.expiresAt ?? null,
    ],
  );
  return String(r.rows[0]!.id);
}

export interface ClaimedMail {
  id: string;
  purpose: MailPurpose;
  ticketId: string | null;
  to: string;
  subject: string;
  bodyText: string;
  inReplyTo: string | null;
  references: string[];
  rfcMessageId: string;
  attempts: number;
}

/** Максимум попыток; после — `failed` (оператор видит «не доставлено»). */
export const MAX_ATTEMPTS = 8;

/** Пауза перед повтором: 1, 2, 4 … мин, не больше часа. */
export function backoffMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

/**
 * Забрать письма к отправке. `FOR UPDATE SKIP LOCKED` — два воркера не возьмут
 * одно письмо; «зависшие» в `sending` дольше 10 минут (воркер упал посреди
 * отправки) возвращаются в очередь. Message-ID назначается при первой попытке
 * и не меняется: повтор — то же письмо, получатель склеит дубль.
 * Истёкшие (`expires_at`) отменяются, не уходя.
 */
export async function claimDueMail(
  db: Queryable,
  opts: { limit: number; domain: string; purposes?: readonly MailPurpose[]; now?: Date },
): Promise<ClaimedMail[]> {
  const now = opts.now ?? new Date();
  await db.query(
    `UPDATE outbound_mail SET status = 'queued', locked_at = NULL
      WHERE status = 'sending' AND locked_at < $1`,
    [new Date(now.getTime() - 10 * 60_000)],
  );
  await db.query(
    `UPDATE outbound_mail SET status = 'cancelled', last_error = 'expired', body_text = NULL
      WHERE status = 'queued' AND expires_at IS NOT NULL AND expires_at < $1`,
    [now],
  );
  const purposes = opts.purposes ?? ['support_reply', 'support_ack', ...SYSTEM_MAIL_PURPOSES];
  const r = await db.query(
    `UPDATE outbound_mail o
        SET status = 'sending', attempts = o.attempts + 1, locked_at = $1,
            rfc_message_id = COALESCE(o.rfc_message_id, '<' || o.id::text || '@' || $3 || '>')
      WHERE o.id IN (
        SELECT id FROM outbound_mail
         WHERE status = 'queued' AND next_attempt_at <= $1 AND purpose = ANY($4::text[])
         ORDER BY next_attempt_at, created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.purpose, o.ticket_id, o.to_address, o.subject, o.body_text, o.in_reply_to,
                o.references_list, o.rfc_message_id, o.attempts`,
    [now, opts.limit, opts.domain, purposes],
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    purpose: x.purpose as MailPurpose,
    ticketId: (x.ticket_id as string | null) ?? null,
    to: String(x.to_address),
    subject: String(x.subject),
    bodyText: String(x.body_text ?? ''),
    inReplyTo: (x.in_reply_to as string | null) ?? null,
    references: (x.references_list as string[] | null) ?? [],
    rfcMessageId: String(x.rfc_message_id),
    attempts: Number(x.attempts),
  }));
}

export async function markMailSent(
  db: Queryable,
  id: string,
  purpose: MailPurpose,
  providerResponse: string,
  now = new Date(),
): Promise<void> {
  const wipe = SECRET_BODY_PURPOSES.includes(purpose);
  await db.query(
    `UPDATE outbound_mail SET status = 'sent', sent_at = $2, locked_at = NULL, provider_response = $3, last_error = NULL,
       body_text = CASE WHEN $4::boolean THEN NULL ELSE body_text END
     WHERE id = $1`,
    [id, now, providerResponse.slice(0, 500), wipe],
  );
}

/**
 * Сбой отправки: повтор по нарастающей паузе; после `MAX_ATTEMPTS` или при
 * постоянной ошибке (адрес отвергнут — 5xx) — `failed`.
 */
export async function markMailFailed(
  db: Queryable,
  mail: { id: string; attempts: number; purpose: MailPurpose },
  error: string,
  opts: { permanent?: boolean; now?: Date } = {},
): Promise<'retry' | 'failed'> {
  const now = opts.now ?? new Date();
  const give = opts.permanent || mail.attempts >= MAX_ATTEMPTS;
  await db.query(
    `UPDATE outbound_mail SET status = $2, locked_at = NULL, last_error = $3, next_attempt_at = $4,
       body_text = CASE WHEN $5::boolean THEN NULL ELSE body_text END
     WHERE id = $1`,
    [
      mail.id,
      give ? 'failed' : 'queued',
      error.slice(0, 500),
      new Date(now.getTime() + backoffMs(mail.attempts)),
      give && SECRET_BODY_PURPOSES.includes(mail.purpose),
    ],
  );
  return give ? 'failed' : 'retry';
}

/** Повторить недоставленное вручную (оператор, кнопка «Отправить ещё раз»). */
export async function requeueMail(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE outbound_mail SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL
      WHERE id = $1 AND status = 'failed' AND purpose IN ('support_reply', 'support_ack') RETURNING id`,
    [id],
  );
  return r.rows.length > 0;
}
