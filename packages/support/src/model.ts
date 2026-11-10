/**
 * Модель поддержки: статусы, переходы, роли и коды журнала (дизайн §3.2–3.4).
 */

export type TicketStatus =
  | 'new'
  | 'open'
  | 'waiting_client'
  | 'waiting_internal'
  | 'resolved'
  | 'closed'
  | 'spam';

export const TICKET_STATUSES: readonly TicketStatus[] = [
  'new',
  'open',
  'waiting_client',
  'waiting_internal',
  'resolved',
  'closed',
  'spam',
];

/** Активные — те, что ещё требуют работы (очередь). */
export const ACTIVE_STATUSES: readonly TicketStatus[] = ['new', 'open', 'waiting_client', 'waiting_internal'];
/** Ждут оператора (SLA тикает, бейдж «ждут ответа»). */
export const AWAITING_OPERATOR: readonly TicketStatus[] = ['new', 'open'];

export type Channel = 'chat' | 'email' | 'web_form';
export type ReplyChannel = 'chat' | 'email';

/**
 * Ручные переходы оператора. Автоматические (ответ оператора → waiting_client,
 * письмо клиента → open, тишина → closed) делает код, не форма.
 *
 *   new ─► open ─► waiting_client ─► open
 *            └─► waiting_internal ─► open
 *   open/waiting_* ─► resolved ─► closed;  resolved ─► open (переоткрыть)
 *   любой (кроме closed) ─► spam (с основанием)
 */
const MANUAL: Record<TicketStatus, readonly TicketStatus[]> = {
  new: ['open', 'waiting_internal', 'resolved', 'spam'],
  open: ['waiting_client', 'waiting_internal', 'resolved', 'spam'],
  waiting_client: ['open', 'waiting_internal', 'resolved', 'spam'],
  waiting_internal: ['open', 'waiting_client', 'resolved', 'spam'],
  resolved: ['open', 'closed', 'spam'],
  closed: ['open'],
  spam: ['open'],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return MANUAL[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: TicketStatus): readonly TicketStatus[] {
  return MANUAL[from] ?? [];
}

/** Роли центра управления (как `operators.role`). */
export type SupportRole = 'admin' | 'operator' | 'finance_operator' | 'support_operator';

export function asSupportRole(v: unknown): SupportRole | null {
  return v === 'admin' || v === 'operator' || v === 'finance_operator' || v === 'support_operator' ? v : null;
}

/**
 * Права поддержки (§3.3). Fail-closed: неизвестная роль — ничего.
 *  - очередь целиком: admin, operator, support_operator;
 *  - finance_operator — только назначенные ему тикеты (эскалация «в финансы»);
 *  - настройки и шаблоны (CRUD) — только admin;
 *  - суммы/балансы/адреса — все, кроме support_operator;
 *  - KYC-документы — admin и operator (не support, не finance).
 */
export const supportAccess = {
  seesWholeQueue: (r: SupportRole | null) => r === 'admin' || r === 'operator' || r === 'support_operator',
  worksTickets: (r: SupportRole | null) =>
    r === 'admin' || r === 'operator' || r === 'support_operator' || r === 'finance_operator',
  managesSettings: (r: SupportRole | null) => r === 'admin',
  seesMoneyAmounts: (r: SupportRole | null) => r === 'admin' || r === 'operator' || r === 'finance_operator',
  seesKycDocuments: (r: SupportRole | null) => r === 'admin' || r === 'operator',
} as const;

/** Коды действий журнала модуля (подписи — apps/admin lib/journal/labels.ts). */
export const SUPPORT_ACTIONS = {
  assigned: 'support.ticket.assigned',
  statusChanged: 'support.ticket.status_changed',
  markedSpam: 'support.ticket.marked_spam',
  linkedClient: 'support.ticket.linked_client',
  autoClosed: 'support.ticket.auto_closed',
  replySent: 'support.reply.sent',
  noteAdded: 'support.note.added',
  contextViewed: 'support.client_context.viewed',
  attachmentViewed: 'support.attachment.viewed',
  settingsUpdated: 'support.settings.updated',
  templateSaved: 'support.template.saved',
  templateDeactivated: 'support.template.deactivated',
  blocklistAdded: 'support.blocklist.added',
  leadsRecovered: 'support.leads.recovered',
  passwordResetRequested: 'auth.password_reset.requested',
  passwordResetCompleted: 'auth.password_reset.completed',
  emailVerifySent: 'auth.email_verify.sent',
  emailVerified: 'auth.email_verify.confirmed',
} as const;

/** Системный автор журнала поддержки (миграция 1795310000000_support). */
export const SUPPORT_SYSTEM_OPERATOR = '00000000-0000-4000-8000-00000000c0b4';
