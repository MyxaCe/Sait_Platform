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

export const ACTIVE_STATUSES: readonly TicketStatus[] = ['new', 'open', 'waiting_client', 'waiting_internal'];
export const AWAITING_OPERATOR: readonly TicketStatus[] = ['new', 'open'];

export type Channel = 'chat' | 'email' | 'web_form';
export type ReplyChannel = 'chat' | 'email';

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

export type SupportRole = 'admin' | 'operator' | 'finance_operator' | 'support_operator';

export function asSupportRole(v: unknown): SupportRole | null {
  return v === 'admin' || v === 'operator' || v === 'finance_operator' || v === 'support_operator' ? v : null;
}

export const supportAccess = {
  seesWholeQueue: (r: SupportRole | null) => r === 'admin' || r === 'operator' || r === 'support_operator',
  worksTickets: (r: SupportRole | null) =>
    r === 'admin' || r === 'operator' || r === 'support_operator' || r === 'finance_operator',
  managesSettings: (r: SupportRole | null) => r === 'admin',
  seesMoneyAmounts: (r: SupportRole | null) => r === 'admin' || r === 'operator' || r === 'finance_operator',
  seesKycDocuments: (r: SupportRole | null) => r === 'admin' || r === 'operator',
} as const;

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
  unactivatedPurged: 'auth.unactivated.purged',
} as const;

export const SUPPORT_SYSTEM_OPERATOR = '00000000-0000-4000-8000-00000000c0b4';
