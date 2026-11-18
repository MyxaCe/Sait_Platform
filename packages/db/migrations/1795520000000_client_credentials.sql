-- Up Migration

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ;

ALTER TABLE client_money_flags ADD COLUMN IF NOT EXISTS withdraw_ban_until TIMESTAMPTZ;
ALTER TABLE client_money_flags ADD COLUMN IF NOT EXISTS withdraw_ban_kind TEXT;
ALTER TABLE client_money_flags ADD COLUMN IF NOT EXISTS withdraw_ban_reason TEXT;
ALTER TABLE client_money_flags DROP CONSTRAINT IF EXISTS client_money_flags_withdraw_ban_kind_check;
ALTER TABLE client_money_flags
  ADD CONSTRAINT client_money_flags_withdraw_ban_kind_check
  CHECK (withdraw_ban_kind IS NULL OR withdraw_ban_kind IN ('money_flags', 'credentials_manual', 'credentials_auto'));

ALTER TABLE outbound_mail DROP CONSTRAINT IF EXISTS outbound_mail_purpose_check;
ALTER TABLE outbound_mail
  ADD CONSTRAINT outbound_mail_purpose_check
  CHECK (purpose IN ('support_reply', 'support_ack', 'password_reset', 'email_verify', 'credentials_notice'));

CREATE TABLE IF NOT EXISTS platform_credential_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_checked INT NOT NULL DEFAULT 1 CHECK (min_checked BETWEEN 0 AND 20),
  auto_hold_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_hold_hours INT NOT NULL DEFAULT 24 CHECK (auto_hold_hours BETWEEN 1 AND 720),
  alert_per_operator_day INT NOT NULL DEFAULT 5 CHECK (alert_per_operator_day BETWEEN 1 AND 1000),
  temp_password_hours INT NOT NULL DEFAULT 24 CHECK (temp_password_hours BETWEEN 1 AND 168),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
INSERT INTO platform_credential_settings (id, checklist) VALUES (1, '[
  {"id": "video_call", "label": "Видеозвонок: лицо сверено с селфи и документом KYC", "required": false},
  {"id": "document_match", "label": "Документ клиента совпадает с данными KYC (тип, номер, срок)", "required": false},
  {"id": "account_questions", "label": "Ответы о счёте: сумма и дата последнего депозита, дата регистрации", "required": false},
  {"id": "known_channel", "label": "Обращение с известного канала (прежний email, телефон, страна входа)", "required": false}
]'::jsonb) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS admin_action_journal_credentials_idx
  ON admin_action_journal (occurred_at, operator_id)
  WHERE action LIKE 'client.credentials.%';
