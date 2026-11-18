-- Up Migration

ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_role_check;
ALTER TABLE operators
  ADD CONSTRAINT operators_role_check
  CHECK (role IN ('admin', 'operator', 'finance_operator', 'support_operator'));

INSERT INTO operators (id, login, display_name, role, disabled_at) VALUES
  ('00000000-0000-4000-8000-00000000c0b4', 'system:support', 'Система · поддержка', 'operator', now())
ON CONFLICT (login) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number BIGINT NOT NULL UNIQUE DEFAULT nextval('support_ticket_number_seq'),
  user_id UUID REFERENCES users(id),
  contact_email TEXT NOT NULL,
  contact_name TEXT,
  locale TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'en')),
  origin_channel TEXT NOT NULL CHECK (origin_channel IN ('chat', 'email', 'web_form')),
  reply_channel TEXT NOT NULL CHECK (reply_channel IN ('chat', 'email')),
  subject TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'open', 'waiting_client', 'waiting_internal', 'resolved', 'closed', 'spam')
  ),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  assignee_operator_id UUID REFERENCES operators(id),
  email_thread_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  source_lead_id UUID UNIQUE REFERENCES leads(id),
  first_response_due_at TIMESTAMPTZ,
  first_responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  last_client_message_at TIMESTAMPTZ,
  last_operator_message_at TIMESTAMPTZ,
  client_last_read_at TIMESTAMPTZ,
  csat_score SMALLINT CHECK (csat_score BETWEEN 1 AND 5),
  csat_comment TEXT,
  csat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status, created_at);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_assignee_idx ON support_tickets (assignee_operator_id);
CREATE INDEX IF NOT EXISTS support_tickets_email_idx ON support_tickets (lower(contact_email));

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('client', 'operator', 'system', 'autoreply')),
  author_user_id UUID REFERENCES users(id),
  author_operator_id UUID REFERENCES operators(id),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
  channel TEXT NOT NULL CHECK (channel IN ('chat', 'email', 'web_form')),
  body_text TEXT NOT NULL,
  template_key TEXT,
  email_message_id TEXT UNIQUE,
  email_in_reply_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_internal_by_operator CHECK (visibility = 'public' OR author_kind = 'operator')
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON support_messages (ticket_id, created_at);

CREATE OR REPLACE FUNCTION support_messages_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'support_messages неизменяемы: % запрещён, переписка только дополняется', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS support_messages_no_change ON support_messages;
CREATE TRIGGER support_messages_no_change
  BEFORE UPDATE OR DELETE ON support_messages
  FOR EACH ROW EXECUTE FUNCTION support_messages_immutable();

CREATE TABLE IF NOT EXISTS support_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES support_messages(id),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id),
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  scan_state TEXT NOT NULL DEFAULT 'skipped' CHECK (scan_state IN ('pending', 'clean', 'infected', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_attachments_message_idx ON support_attachments (message_id);

CREATE TABLE IF NOT EXISTS outbound_mail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL CHECK (
    purpose IN ('support_reply', 'support_ack', 'password_reset', 'email_verify')
  ),
  ticket_id UUID REFERENCES support_tickets(id),
  message_id UUID REFERENCES support_messages(id),
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  in_reply_to TEXT,
  references_list TEXT[] NOT NULL DEFAULT '{}',
  rfc_message_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_response TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbound_mail_due_idx ON outbound_mail (next_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS outbound_mail_ticket_idx ON outbound_mail (ticket_id);

CREATE TABLE IF NOT EXISTS inbound_mail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox TEXT NOT NULL,
  uid BIGINT,
  uidvalidity BIGINT,
  message_id TEXT NOT NULL UNIQUE,
  from_address TEXT NOT NULL,
  to_addresses TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  received_at TIMESTAMPTZ,
  verdict TEXT NOT NULL DEFAULT 'pending' CHECK (
    verdict IN ('pending', 'accepted', 'loop', 'own', 'blocked', 'spam', 'failed')
  ),
  verdict_reason TEXT,
  ticket_id UUID REFERENCES support_tickets(id),
  support_message_id UUID REFERENCES support_messages(id),
  raw_object_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbound_mail_from_idx ON inbound_mail (lower(from_address), created_at);

CREATE TABLE IF NOT EXISTS support_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
INSERT INTO support_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  locale TEXT NOT NULL CHECK (locale IN ('ru', 'en')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES operators(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_templates_key_locale UNIQUE (key, locale)
);

CREATE TABLE IF NOT EXISTS support_blocklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('email', 'domain')),
  value TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID REFERENCES operators(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS support_blocklist_value_uniq ON support_blocklist (kind, lower(value));

CREATE TABLE IF NOT EXISTS support_mail_status (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_configured BOOLEAN NOT NULL DEFAULT false,
  imap_configured BOOLEAN NOT NULL DEFAULT false,
  missing_env TEXT[] NOT NULL DEFAULT '{}',
  mailbox TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  last_inbound_ok_at TIMESTAMPTZ,
  last_outbound_ok_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ
);
