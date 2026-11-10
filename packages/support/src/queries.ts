import type { Queryable } from '@broker/money';
import { AWAITING_OPERATOR, supportAccess, type Channel, type ReplyChannel, type SupportRole, type TicketStatus } from './model';
import type { MailStatus } from './outbound';
import type { Actor } from './tickets';

/** Чтения поддержки: очередь и тикет для оператора, переписка для клиента. */

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

export type QueueFilter = 'awaiting' | 'mine' | 'unassigned' | 'waiting' | 'resolved' | 'closed' | 'spam' | 'all';
export const QUEUE_FILTERS: readonly QueueFilter[] = ['awaiting', 'mine', 'unassigned', 'waiting', 'resolved', 'closed', 'spam', 'all'];

export interface QueueRow {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: 'normal' | 'high';
  originChannel: Channel;
  replyChannel: ReplyChannel;
  contactEmail: string;
  contactName: string | null;
  userId: string | null;
  clientName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
  lastClientMessageAt: string | null;
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  /** SLA первого ответа нарушен (ждёт оператора и срок прошёл). */
  overdue: boolean;
  messageCount: number;
}

/** Ограничение видимости по роли — в SQL, а не после выборки. */
function scopeSql(actor: Actor, params: unknown[]): string {
  if (supportAccess.seesWholeQueue(actor.role)) return 'TRUE';
  if (actor.role === 'finance_operator') {
    params.push(actor.operatorId);
    return `t.assignee_operator_id = $${params.length}`;
  }
  return 'FALSE';
}

function filterSql(filter: QueueFilter, actor: Actor, params: unknown[]): string {
  switch (filter) {
    case 'awaiting':
      return `t.status IN ('new', 'open')`;
    case 'mine':
      params.push(actor.operatorId);
      return `t.assignee_operator_id = $${params.length} AND t.status NOT IN ('closed', 'spam')`;
    case 'unassigned':
      return `t.assignee_operator_id IS NULL AND t.status NOT IN ('resolved', 'closed', 'spam')`;
    case 'waiting':
      return `t.status IN ('waiting_client', 'waiting_internal')`;
    case 'resolved':
      return `t.status = 'resolved'`;
    case 'closed':
      return `t.status = 'closed'`;
    case 'spam':
      return `t.status = 'spam'`;
    default:
      return 'TRUE';
  }
}

export interface QueueQuery {
  filter: QueueFilter;
  channel?: Channel | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
  now?: Date;
}

export async function listQueue(db: Queryable, actor: Actor, query: QueueQuery): Promise<{ rows: QueueRow[]; total: number }> {
  const params: unknown[] = [];
  const where = [scopeSql(actor, params), filterSql(query.filter, actor, params)];
  if (query.channel) {
    params.push(query.channel);
    where.push(`t.origin_channel = $${params.length}`);
  }
  const q = (query.q ?? '').trim();
  if (q) {
    const num = /^#?(\d{1,12})$/.exec(q);
    if (num) {
      params.push(Number(num[1]));
      where.push(`t.number = $${params.length}`);
    } else {
      params.push(`%${q.replace(/[%_\\]/g, '\\$&').toLowerCase()}%`);
      const p = `$${params.length}`;
      where.push(`(lower(t.subject) LIKE ${p} OR lower(t.contact_email) LIKE ${p} OR lower(COALESCE(t.contact_name, '')) LIKE ${p}
        OR lower(COALESCE(u.full_name, '')) LIKE ${p})`);
    }
  }
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const now = query.now ?? new Date();
  params.push(now);
  const nowP = `$${params.length}`;
  // Порядок: ждущие оператора — по сроку SLA (что горит — сверху), прочие — свежие сверху.
  const order =
    query.filter === 'awaiting' || query.filter === 'unassigned' || query.filter === 'mine'
      ? `CASE WHEN t.status IN ('new','open') THEN 0 ELSE 1 END, t.first_response_due_at NULLS LAST, t.created_at`
      : `t.updated_at DESC`;
  const sqlWhere = where.join(' AND ');
  const total = await db.query(
    `SELECT count(*)::int AS n FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE ${sqlWhere}`,
    params.slice(0, -1),
  );
  params.push(pageSize, (page - 1) * pageSize);
  const r = await db.query(
    `SELECT t.id, t.number, t.subject, t.status, t.priority, t.origin_channel, t.reply_channel, t.contact_email,
            t.contact_name, t.user_id, u.full_name AS client_name, t.assignee_operator_id, o.display_name AS assignee_name,
            t.created_at, t.updated_at, t.last_client_message_at, t.first_response_due_at, t.first_responded_at,
            (t.status IN ('new','open') AND t.first_responded_at IS NULL AND t.first_response_due_at < ${nowP}) AS overdue,
            (SELECT count(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN operators o ON o.id = t.assignee_operator_id
      WHERE ${sqlWhere}
      ORDER BY ${order}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    total: Number(total.rows[0]?.n ?? 0),
    rows: r.rows.map((x) => ({
      id: String(x.id),
      number: Number(x.number),
      subject: String(x.subject),
      status: x.status as TicketStatus,
      priority: x.priority as 'normal' | 'high',
      originChannel: x.origin_channel as Channel,
      replyChannel: x.reply_channel as ReplyChannel,
      contactEmail: String(x.contact_email),
      contactName: (x.contact_name as string | null) ?? null,
      userId: (x.user_id as string | null) ?? null,
      clientName: (x.client_name as string | null) ?? null,
      assigneeId: (x.assignee_operator_id as string | null) ?? null,
      assigneeName: (x.assignee_name as string | null) ?? null,
      createdAt: iso(x.created_at),
      updatedAt: iso(x.updated_at),
      lastClientMessageAt: isoOrNull(x.last_client_message_at),
      firstResponseDueAt: isoOrNull(x.first_response_due_at),
      firstRespondedAt: isoOrNull(x.first_responded_at),
      overdue: Boolean(x.overdue),
      messageCount: Number(x.message_count),
    })),
  };
}

export interface QueueStats {
  awaiting: number;
  overdue: number;
  unassigned: number;
  waiting: number;
  mine: number;
  oldestAwaitingAt: string | null;
  resolvedToday: number;
  csatAvg: number | null;
  csatCount: number;
}

export async function queueStats(db: Queryable, actor: Actor, now = new Date()): Promise<QueueStats> {
  const params: unknown[] = [];
  const scope = scopeSql(actor, params);
  params.push(now, actor.operatorId);
  const n = params.length;
  const r = await db.query(
    `SELECT
       count(*) FILTER (WHERE t.status IN ('new','open'))::int AS awaiting,
       count(*) FILTER (WHERE t.status IN ('new','open') AND t.first_responded_at IS NULL AND t.first_response_due_at < $${n - 1})::int AS overdue,
       count(*) FILTER (WHERE t.assignee_operator_id IS NULL AND t.status NOT IN ('resolved','closed','spam'))::int AS unassigned,
       count(*) FILTER (WHERE t.status IN ('waiting_client','waiting_internal'))::int AS waiting,
       count(*) FILTER (WHERE t.assignee_operator_id = $${n} AND t.status NOT IN ('closed','spam'))::int AS mine,
       min(COALESCE(t.last_client_message_at, t.created_at)) FILTER (WHERE t.status IN ('new','open')) AS oldest,
       count(*) FILTER (WHERE t.resolved_at > $${n - 1}::timestamptz - interval '24 hours')::int AS resolved_today,
       avg(t.csat_score) FILTER (WHERE t.csat_score IS NOT NULL) AS csat_avg,
       count(t.csat_score)::int AS csat_count
     FROM support_tickets t WHERE ${scope}`,
    params,
  );
  const x = r.rows[0] ?? {};
  return {
    awaiting: Number(x.awaiting ?? 0),
    overdue: Number(x.overdue ?? 0),
    unassigned: Number(x.unassigned ?? 0),
    waiting: Number(x.waiting ?? 0),
    mine: Number(x.mine ?? 0),
    oldestAwaitingAt: isoOrNull(x.oldest),
    resolvedToday: Number(x.resolved_today ?? 0),
    csatAvg: x.csat_avg == null ? null : Math.round(Number(x.csat_avg) * 10) / 10,
    csatCount: Number(x.csat_count ?? 0),
  };
}

export interface AttachmentView {
  id: string;
  messageId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  objectKey: string;
}

export interface MessageView {
  id: string;
  authorKind: 'client' | 'operator' | 'system' | 'autoreply';
  authorName: string | null;
  visibility: 'public' | 'internal';
  channel: Channel;
  body: string;
  templateKey: string | null;
  createdAt: string;
  attachments: AttachmentView[];
  delivery: { status: MailStatus; attempts: number; lastError: string | null; sentAt: string | null; outboundId: string } | null;
}

export interface TicketView {
  id: string;
  number: number;
  subject: string;
  category: string | null;
  status: TicketStatus;
  priority: 'normal' | 'high';
  originChannel: Channel;
  replyChannel: ReplyChannel;
  contactEmail: string;
  contactName: string | null;
  locale: 'ru' | 'en';
  userId: string | null;
  clientName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  csatScore: number | null;
  csatComment: string | null;
  sourceLeadId: string | null;
  messages: MessageView[];
  /** Клиенты с тем же email (гостевой тикет — предложить склейку). */
  suggestedClients: { id: string; fullName: string; email: string }[];
  /** Письмо-подтверждение (автоответ) и его доставка. */
  acks: { status: MailStatus; createdAt: string; lastError: string | null }[];
}

/** Тикет для оператора по номеру или id; `null` — нет или нет доступа. */
export async function getTicketForOperator(db: Queryable, actor: Actor, ref: string): Promise<TicketView | null> {
  if (!supportAccess.worksTickets(actor.role)) return null;
  const byNumber = /^\d{1,12}$/.test(ref);
  if (!byNumber && !/^[0-9a-f-]{36}$/i.test(ref)) return null;
  const r = await db.query(
    `SELECT t.*, u.full_name AS client_name, o.display_name AS assignee_name
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN operators o ON o.id = t.assignee_operator_id
      WHERE ${byNumber ? 't.number = $1' : 't.id = $1'}`,
    [byNumber ? Number(ref) : ref],
  );
  const t = r.rows[0];
  if (!t) return null;
  if (!supportAccess.seesWholeQueue(actor.role) && t.assignee_operator_id !== actor.operatorId) return null;
  const id = String(t.id);

  const [msgs, atts, outs, sugg] = await Promise.all([
    db.query(
      `SELECT m.id, m.author_kind, m.visibility, m.channel, m.body_text, m.template_key, m.created_at,
              COALESCE(o.display_name, u.full_name) AS author_name
         FROM support_messages m
         LEFT JOIN operators o ON o.id = m.author_operator_id
         LEFT JOIN users u ON u.id = m.author_user_id
        WHERE m.ticket_id = $1 ORDER BY m.created_at, m.id`,
      [id],
    ),
    db.query(
      `SELECT id, message_id, filename, mime, size_bytes, object_key FROM support_attachments WHERE ticket_id = $1 ORDER BY created_at`,
      [id],
    ),
    db.query(
      `SELECT id, purpose, message_id, status, attempts, last_error, sent_at, created_at
         FROM outbound_mail WHERE ticket_id = $1 ORDER BY created_at`,
      [id],
    ),
    t.user_id
      ? Promise.resolve({ rows: [] as Record<string, unknown>[] })
      : db.query(`SELECT id, full_name, email FROM users WHERE lower(email) = lower($1) LIMIT 3`, [t.contact_email]),
  ]);
  const attByMsg = new Map<string, AttachmentView[]>();
  for (const a of atts.rows) {
    const v: AttachmentView = {
      id: String(a.id),
      messageId: String(a.message_id),
      filename: String(a.filename),
      mime: String(a.mime),
      sizeBytes: Number(a.size_bytes),
      objectKey: String(a.object_key),
    };
    attByMsg.set(v.messageId, [...(attByMsg.get(v.messageId) ?? []), v]);
  }
  const outByMsg = new Map<string, Record<string, unknown>>();
  for (const o of outs.rows) if (o.message_id) outByMsg.set(String(o.message_id), o);

  return {
    id,
    number: Number(t.number),
    subject: String(t.subject),
    category: (t.category as string | null) ?? null,
    status: t.status as TicketStatus,
    priority: t.priority as 'normal' | 'high',
    originChannel: t.origin_channel as Channel,
    replyChannel: t.reply_channel as ReplyChannel,
    contactEmail: String(t.contact_email),
    contactName: (t.contact_name as string | null) ?? null,
    locale: t.locale === 'en' ? 'en' : 'ru',
    userId: (t.user_id as string | null) ?? null,
    clientName: (t.client_name as string | null) ?? null,
    assigneeId: (t.assignee_operator_id as string | null) ?? null,
    assigneeName: (t.assignee_name as string | null) ?? null,
    createdAt: iso(t.created_at),
    firstResponseDueAt: isoOrNull(t.first_response_due_at),
    firstRespondedAt: isoOrNull(t.first_responded_at),
    resolvedAt: isoOrNull(t.resolved_at),
    closedAt: isoOrNull(t.closed_at),
    csatScore: t.csat_score == null ? null : Number(t.csat_score),
    csatComment: (t.csat_comment as string | null) ?? null,
    sourceLeadId: (t.source_lead_id as string | null) ?? null,
    messages: msgs.rows.map((m) => {
      const o = outByMsg.get(String(m.id));
      return {
        id: String(m.id),
        authorKind: m.author_kind as MessageView['authorKind'],
        authorName: (m.author_name as string | null) ?? null,
        visibility: m.visibility as 'public' | 'internal',
        channel: m.channel as Channel,
        body: String(m.body_text),
        templateKey: (m.template_key as string | null) ?? null,
        createdAt: iso(m.created_at),
        attachments: attByMsg.get(String(m.id)) ?? [],
        delivery: o
          ? {
              status: o.status as MailStatus,
              attempts: Number(o.attempts),
              lastError: (o.last_error as string | null) ?? null,
              sentAt: isoOrNull(o.sent_at),
              outboundId: String(o.id),
            }
          : null,
      };
    }),
    suggestedClients: sugg.rows.map((s) => ({ id: String(s.id), fullName: String(s.full_name), email: String(s.email) })),
    acks: outs.rows
      .filter((o) => o.purpose === 'support_ack')
      .map((o) => ({ status: o.status as MailStatus, createdAt: iso(o.created_at), lastError: (o.last_error as string | null) ?? null })),
  };
}

/** Тикеты клиента — вкладка «Поддержка» карточки клиента. */
export async function listClientTickets(db: Queryable, userId: string, email?: string | null): Promise<QueueRow[]> {
  const r = await db.query(
    `SELECT t.id, t.number, t.subject, t.status, t.priority, t.origin_channel, t.reply_channel, t.contact_email,
            t.contact_name, t.user_id, t.assignee_operator_id, o.display_name AS assignee_name, t.created_at, t.updated_at,
            t.last_client_message_at, t.first_response_due_at, t.first_responded_at,
            (SELECT count(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t LEFT JOIN operators o ON o.id = t.assignee_operator_id
      WHERE t.user_id = $1 OR (t.user_id IS NULL AND $2::text IS NOT NULL AND lower(t.contact_email) = lower($2))
      ORDER BY t.created_at DESC LIMIT 100`,
    [userId, email ?? null],
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    number: Number(x.number),
    subject: String(x.subject),
    status: x.status as TicketStatus,
    priority: x.priority as 'normal' | 'high',
    originChannel: x.origin_channel as Channel,
    replyChannel: x.reply_channel as ReplyChannel,
    contactEmail: String(x.contact_email),
    contactName: (x.contact_name as string | null) ?? null,
    userId: (x.user_id as string | null) ?? null,
    clientName: null,
    assigneeId: (x.assignee_operator_id as string | null) ?? null,
    assigneeName: (x.assignee_name as string | null) ?? null,
    createdAt: iso(x.created_at),
    updatedAt: iso(x.updated_at),
    lastClientMessageAt: isoOrNull(x.last_client_message_at),
    firstResponseDueAt: isoOrNull(x.first_response_due_at),
    firstRespondedAt: isoOrNull(x.first_responded_at),
    overdue: false,
    messageCount: Number(x.message_count),
  }));
}

/** Операторы, которым можно назначить тикет. */
export async function listAssignableOperators(db: Queryable): Promise<{ id: string; name: string; role: SupportRole }[]> {
  const r = await db.query(
    `SELECT id, display_name, role FROM operators
      WHERE disabled_at IS NULL AND login NOT LIKE 'system:%'
        AND role IN ('admin', 'operator', 'support_operator', 'finance_operator')
      ORDER BY display_name`,
  );
  return r.rows.map((x) => ({ id: String(x.id), name: String(x.display_name), role: x.role as SupportRole }));
}

/* ─── Клиентская сторона (кабинет) ──────────────────────────────────── */

export interface ClientMessageView {
  id: string;
  mine: boolean;
  authorKind: 'client' | 'operator' | 'system' | 'autoreply';
  authorName: string | null;
  body: string;
  createdAt: string;
  attachments: { id: string; filename: string; mime: string; sizeBytes: number }[];
}

export interface ClientChat {
  ticket: {
    id: string;
    number: number;
    subject: string;
    status: TicketStatus;
    csatScore: number | null;
    createdAt: string;
  } | null;
  messages: ClientMessageView[];
  unread: number;
  history: { id: string; number: number; subject: string; status: TicketStatus; createdAt: string }[];
}

/**
 * Переписка клиента. ВНУТРЕННИЕ ЗАМЕТКИ НЕ ВЫБИРАЮТСЯ (`visibility = 'public'`
 * в самом запросе); имя оператора — только отображаемое имя (без логина).
 */
export async function getClientChat(db: Queryable, userId: string, ticketId?: string | null): Promise<ClientChat> {
  const tr = await db.query(
    ticketId
      ? `SELECT id, number, subject, status, csat_score, created_at FROM support_tickets WHERE user_id = $1 AND id = $2`
      : `SELECT id, number, subject, status, csat_score, created_at FROM support_tickets
          WHERE user_id = $1 AND status NOT IN ('spam') AND reply_channel = 'chat'
          ORDER BY (status = 'closed'), created_at DESC LIMIT 1`,
    ticketId ? [userId, ticketId] : [userId],
  );
  const t = tr.rows[0];
  const history = await db.query(
    `SELECT id, number, subject, status, created_at FROM support_tickets
      WHERE user_id = $1 AND status <> 'spam' ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );
  const unread = await countClientUnread(db, userId);
  if (!t) {
    return {
      ticket: null,
      messages: [],
      unread,
      history: history.rows.map((h) => ({ id: String(h.id), number: Number(h.number), subject: String(h.subject), status: h.status as TicketStatus, createdAt: iso(h.created_at) })),
    };
  }
  const msgs = await db.query(
    `SELECT m.id, m.author_kind, m.body_text, m.created_at, o.display_name AS operator_name
       FROM support_messages m LEFT JOIN operators o ON o.id = m.author_operator_id
      WHERE m.ticket_id = $1 AND m.visibility = 'public'
      ORDER BY m.created_at, m.id`,
    [t.id],
  );
  const atts = await db.query(
    `SELECT a.id, a.message_id, a.filename, a.mime, a.size_bytes
       FROM support_attachments a JOIN support_messages m ON m.id = a.message_id
      WHERE a.ticket_id = $1 AND m.visibility = 'public'`,
    [t.id],
  );
  const byMsg = new Map<string, ClientMessageView['attachments']>();
  for (const a of atts.rows) {
    const k = String(a.message_id);
    byMsg.set(k, [...(byMsg.get(k) ?? []), { id: String(a.id), filename: String(a.filename), mime: String(a.mime), sizeBytes: Number(a.size_bytes) }]);
  }
  return {
    ticket: {
      id: String(t.id),
      number: Number(t.number),
      subject: String(t.subject),
      status: t.status as TicketStatus,
      csatScore: t.csat_score == null ? null : Number(t.csat_score),
      createdAt: iso(t.created_at),
    },
    messages: msgs.rows.map((m) => ({
      id: String(m.id),
      mine: m.author_kind === 'client',
      authorKind: m.author_kind as ClientMessageView['authorKind'],
      authorName: m.author_kind === 'operator' ? ((m.operator_name as string | null) ?? null) : null,
      body: String(m.body_text),
      createdAt: iso(m.created_at),
      attachments: byMsg.get(String(m.id)) ?? [],
    })),
    unread,
    history: history.rows.map((h) => ({ id: String(h.id), number: Number(h.number), subject: String(h.subject), status: h.status as TicketStatus, createdAt: iso(h.created_at) })),
  };
}

/** Непрочитанные ответы поддержки (бейдж на кнопке чата). */
export async function countClientUnread(db: Queryable, userId: string): Promise<number> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM support_messages m JOIN support_tickets t ON t.id = m.ticket_id
      WHERE t.user_id = $1 AND m.visibility = 'public' AND m.author_kind IN ('operator', 'autoreply', 'system')
        AND m.created_at > COALESCE(t.client_last_read_at, 'epoch'::timestamptz)`,
    [userId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Вложение, доступное клиенту (свой тикет, публичное сообщение). */
export async function findClientAttachment(db: Queryable, userId: string, attachmentId: string): Promise<{ objectKey: string; filename: string; mime: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return null;
  const r = await db.query(
    `SELECT a.object_key, a.filename, a.mime FROM support_attachments a
       JOIN support_tickets t ON t.id = a.ticket_id JOIN support_messages m ON m.id = a.message_id
      WHERE a.id = $1 AND t.user_id = $2 AND m.visibility = 'public'`,
    [attachmentId, userId],
  );
  const a = r.rows[0];
  return a ? { objectKey: String(a.object_key), filename: String(a.filename), mime: String(a.mime) } : null;
}

export const AWAITING = AWAITING_OPERATOR;
