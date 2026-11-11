import type { Queryable } from '@broker/money';
import { canonicalSha256, sha256Hex } from './envelope';

/**
 * Доказательство инициативы клиента — ТОЛЬКО тикет поддержки (решение
 * владельца 10.11): клиент пишет заявление в техподдержку (чат кабинета или
 * письмо на support@), менеджер привязывает этот тикет к переводу.
 *
 * Система проверяет, а не верит отметке:
 *  - тикет привязан к ЭТОМУ клиенту (`support_tickets.user_id`);
 *  - ПЕРВОЕ сообщение тикета (любая видимость) написал клиент
 *    (`author_kind = 'client'`). Тикет, открытый оператором, не принимается;
 *  - тикет ещё не служит основанием другого живого перевода;
 *  - согласие на передачу данных — конкретное сообщение КЛИЕНТА в этом же
 *    тикете (публичное), созданное не позже проведения перевода.
 *
 * В пакет и журнал уходит не текст, а sha256 канонической формы доказательства.
 */

/** Версия текста согласия, на которое ссылается отметка менеджера. */
export const CONSENT_TEXT_VERSION = 'transfer-consent-v1-2026-11-10';

export const CONSENT_TEXT_RU =
  'Клиент в своём сообщении в поддержку просит перевести его на платформу группы и соглашается, ' +
  'чтобы платформа-источник передала платформе-цели (другое юрлицо группы, своя юрисдикция) его ФИО, ' +
  'email, страну, язык, статус и дату проверки KYC — только для приглашения к самостоятельной ' +
  'регистрации. Документы KYC и сведения о средствах не передаются; KYC в цели проходится заново.';

export const CONSENT_TEXT_SHA256 = sha256Hex(CONSENT_TEXT_RU);

export interface TicketMessageView {
  id: string;
  authorKind: string;
  channel: string;
  createdAt: string;
  excerpt: string;
}

export interface EligibleTicket {
  ticketId: string;
  number: number;
  subject: string;
  status: string;
  originChannel: string;
  createdAt: string;
  /** Первое сообщение тикета (от клиента). */
  first: TicketMessageView;
  /** Сообщения клиента — кандидаты «согласие». */
  clientMessages: TicketMessageView[];
  /** Уже служит основанием живого перевода. */
  usedByTransfer: string | null;
}

export interface RejectedTicket {
  ticketId: string;
  number: number;
  subject: string;
  reason: 'openedByOperator' | 'noMessages';
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const excerpt = (t: unknown) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > 280 ? `${s.slice(0, 279)}…` : s;
};

/** Тикеты клиента для формы перевода: годные и отвергнутые (с причиной). */
export async function listTicketsForTransfer(
  db: Queryable,
  userId: string,
): Promise<{ eligible: EligibleTicket[]; rejected: RejectedTicket[] }> {
  const t = await db.query(
    `SELECT t.id, t.number, t.subject, t.status, t.origin_channel, t.created_at,
            (SELECT p.number FROM platform_transfers p
              WHERE p.evidence_ticket_id = t.id AND p.status NOT IN ('refused', 'expired', 'revoked') LIMIT 1) AS used_by
       FROM support_tickets t
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC
      LIMIT 50`,
    [userId],
  );
  const eligible: EligibleTicket[] = [];
  const rejected: RejectedTicket[] = [];
  for (const row of t.rows) {
    const msgs = await db.query(
      `SELECT id, author_kind, channel, visibility, body_text, created_at
         FROM support_messages WHERE ticket_id = $1 ORDER BY created_at, id`,
      [row.id],
    );
    const first = msgs.rows[0];
    const base = { ticketId: String(row.id), number: Number(row.number), subject: String(row.subject) };
    if (!first) {
      rejected.push({ ...base, reason: 'noMessages' });
      continue;
    }
    if (first.author_kind !== 'client') {
      rejected.push({ ...base, reason: 'openedByOperator' });
      continue;
    }
    const view = (m: Record<string, unknown>): TicketMessageView => ({
      id: String(m.id),
      authorKind: String(m.author_kind),
      channel: String(m.channel),
      createdAt: iso(m.created_at),
      excerpt: excerpt(m.body_text),
    });
    eligible.push({
      ...base,
      status: String(row.status),
      originChannel: String(row.origin_channel),
      createdAt: iso(row.created_at),
      first: view(first),
      clientMessages: msgs.rows.filter((m) => m.author_kind === 'client' && m.visibility === 'public').map(view),
      usedByTransfer: row.used_by ? String(row.used_by) : null,
    });
  }
  return { eligible, rejected };
}

export type EvidenceError =
  | 'ticketNotFound'
  | 'ticketNotClients'
  | 'ticketOpenedByOperator'
  | 'ticketAlreadyUsed'
  | 'consentMessageInvalid';

export interface VerifiedEvidence {
  ticketId: string;
  ticketNumber: number;
  firstMessageId: string;
  consentMessageId: string;
  consentAt: string;
  evidenceSha256: string;
  consentMessageSha256: string;
}

/**
 * Серверная проверка доказательства (повторно, внутри транзакции перевода —
 * форма могла устареть). Блокирует строку тикета от гонки двух переводов.
 */
export async function verifyTicketEvidence(
  tx: Queryable,
  input: { userId: string; ticketId: string; consentMessageId: string; now: Date },
): Promise<{ ok: true; value: VerifiedEvidence } | { ok: false; reason: EvidenceError }> {
  const t = await tx.query(`SELECT id, number, user_id FROM support_tickets WHERE id = $1 FOR UPDATE`, [input.ticketId]);
  const ticket = t.rows[0];
  if (!ticket) return { ok: false, reason: 'ticketNotFound' };
  if (String(ticket.user_id ?? '') !== input.userId) return { ok: false, reason: 'ticketNotClients' };
  const first = await tx.query(
    `SELECT id, author_kind, body_text, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY created_at, id LIMIT 1`,
    [input.ticketId],
  );
  const f = first.rows[0];
  if (!f || f.author_kind !== 'client') return { ok: false, reason: 'ticketOpenedByOperator' };
  if (new Date(iso(f.created_at)) > input.now) {
    return { ok: false, reason: 'ticketOpenedByOperator' };
  }
  const used = await tx.query(
    `SELECT 1 FROM platform_transfers WHERE evidence_ticket_id = $1 AND status NOT IN ('refused', 'expired', 'revoked')`,
    [input.ticketId],
  );
  if (used.rows.length) return { ok: false, reason: 'ticketAlreadyUsed' };
  const c = await tx.query(
    `SELECT id, body_text, created_at FROM support_messages
      WHERE id = $1 AND ticket_id = $2 AND author_kind = 'client' AND visibility = 'public'`,
    [input.consentMessageId, input.ticketId],
  );
  const consent = c.rows[0];
  if (!consent || new Date(iso(consent.created_at)) > input.now) return { ok: false, reason: 'consentMessageInvalid' };

  const evidenceSha256 = canonicalSha256({
    kind: 'support_ticket',
    ticketId: String(ticket.id),
    ticketNumber: Number(ticket.number),
    firstMessageId: String(f.id),
    firstMessageAt: iso(f.created_at),
    firstMessageSha256: sha256Hex(String(f.body_text ?? '')),
  });
  return {
    ok: true,
    value: {
      ticketId: String(ticket.id),
      ticketNumber: Number(ticket.number),
      firstMessageId: String(f.id),
      consentMessageId: String(consent.id),
      consentAt: iso(consent.created_at),
      evidenceSha256,
      consentMessageSha256: sha256Hex(String(consent.body_text ?? '')),
    },
  };
}
