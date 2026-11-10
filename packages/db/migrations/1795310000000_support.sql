-- Up Migration
--
-- Модуль «Поддержка» (дизайн «ДЕМО-поддержка-чат-почта», вариант A — свой
-- модуль; решения владельца 10.11). Обращение клиента — тикет; переписка —
-- append-only сообщения; почта — очередь исходящих и журнал входящих.
--
-- Принципы:
--  * Сообщения НЕИЗМЕНЯЕМЫ на уровне базы (как журнал, Р-049): правка — новое
--    сообщение. Поэтому всё изменчивое (доставка письма, «клиент прочитал»)
--    живёт НЕ в сообщении: доставка — в `outbound_mail`, прочтение —
--    `support_tickets.client_last_read_at`.
--  * Действия оператора пишутся в `admin_action_journal` той же транзакцией;
--    текст ответа в журнал НЕ кладётся (ПДн не дублируем) — только id и sha256.
--  * Настройки — один JSONB на базу (= на тенант/ячейку, как
--    platform_money_settings): ключи совпадают с будущим глобалом CMS
--    «Поддержка», переезд — смена источника, а не схемы.
--  * Секретов почты здесь нет: хост/логин/пароль ящика — только env воркера.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

-- Роль оператора поддержки: очередь и переписка, контекст клиента БЕЗ сумм,
-- балансов, адресов кошельков и KYC-документов (решение владельца 10.11).
ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_role_check;
ALTER TABLE operators
  ADD CONSTRAINT operators_role_check
  CHECK (role IN ('admin', 'operator', 'finance_operator', 'support_operator'));

-- Системный автор журнала для автоматических переходов поддержки (приём
-- письма, автозакрытие, восстановление обращений). Войти нельзя: пароля нет,
-- учётка отключена (как system:cabinet / system:chain-watcher).
INSERT INTO operators (id, login, display_name, role, disabled_at) VALUES
  ('00000000-0000-4000-8000-00000000c0b3', 'system:support', 'Система · поддержка', 'operator', now())
ON CONFLICT (login) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Человекочитаемый номер: «#1042», метка `[#1042]` в теме письма.
  number BIGINT NOT NULL UNIQUE DEFAULT nextval('support_ticket_number_seq'),
  -- NULL — гость (форма витрины, письмо с незнакомого адреса). Склейка с
  -- клиентом — только действием оператора с основанием (не молча).
  user_id UUID REFERENCES users(id),
  contact_email TEXT NOT NULL,
  contact_name TEXT,
  locale TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'en')),
  origin_channel TEXT NOT NULL CHECK (origin_channel IN ('chat', 'email', 'web_form')),
  -- Куда уходит ответ оператора: в чат кабинета или письмом.
  reply_channel TEXT NOT NULL CHECK (reply_channel IN ('chat', 'email')),
  subject TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'open', 'waiting_client', 'waiting_internal', 'resolved', 'closed', 'spam')
  ),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  assignee_operator_id UUID REFERENCES operators(id),
  -- Неугадываемый токен цепочки (plus-адрес support+<token>@ — доп. признак).
  email_thread_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  -- Обращение с формы контактов, восстановленное из `leads` (идемпотентность).
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
  -- Внутренняя заметка клиенту не видна НИКОГДА (фильтр в каждом чтении кабинета).
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
  channel TEXT NOT NULL CHECK (channel IN ('chat', 'email', 'web_form')),
  body_text TEXT NOT NULL,
  template_key TEXT,
  -- Входящее письмо: его Message-ID (дедуп) и на что отвечало.
  email_message_id TEXT UNIQUE,
  email_in_reply_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_internal_by_operator CHECK (visibility = 'public' OR author_kind = 'operator')
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON support_messages (ticket_id, created_at);

-- Сообщения неизменяемы базой (как журнал, Р-049): правка = новое сообщение.
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

-- Вложения: байты в объектном хранилище (support/{tenant}/{ticket}/{uuid}),
-- здесь — ключ и проверяемые свойства. Ссылка — только подписанный URL.
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

-- Очередь исходящих писем (дух ADR-018: письмо пишется в той же транзакции,
-- что и сообщение; шлёт отдельный воркер). Общая для поддержки и auth-писем
-- (сброс пароля, подтверждение email). Тело auth-письма после отправки
-- стирается (в нём одноразовая ссылка).
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
  -- Наш Message-ID: ставится воркером при первой попытке и не меняется
  -- (повторная отправка того же письма — тот же Message-ID).
  rfc_message_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  -- Письмо, потерявшее смысл (автоответ/ссылка), не уходит после срока.
  expires_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_response TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbound_mail_due_idx ON outbound_mail (next_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS outbound_mail_ticket_idx ON outbound_mail (ticket_id);

-- Входящие письма: дедуп по Message-ID, вердикт, ключ сырого .eml.
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

-- Настройки поддержки: одна строка на базу (= на тенант/ячейку).
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

-- Состояние почтового канала — пишет воркер (heartbeat), читает админка:
-- «почта не настроена» / «воркер не запущен» / «последний приём». Секретов нет.
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
