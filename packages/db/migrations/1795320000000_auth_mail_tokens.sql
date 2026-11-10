-- Up Migration
--
-- Одноразовые токены auth-писем: сброс пароля и подтверждение email
-- (решение владельца 10.11 — через ту же почту поддержки, SMTP cPanel).
--
-- В базе — только sha256 токена: дамп базы не даёт ни одной рабочей ссылки.
-- Токен одноразовый (`used_at`), со сроком (`expires_at`). Частота запросов
-- считается по этой же таблице (по email и по IP), а не в памяти процесса —
-- лимит переживает рестарт и общий для всех реплик кабинета.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

CREATE TABLE IF NOT EXISTS auth_mail_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  -- NULL — запрос на несуществующий email (строка нужна только для лимита
  -- частоты; письма по ней не уходит, и ответ формы от этого не меняется).
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  request_ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_mail_tokens_token_has_user CHECK (token_hash IS NULL OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS auth_mail_tokens_email_idx ON auth_mail_tokens (purpose, lower(email), created_at);
CREATE INDEX IF NOT EXISTS auth_mail_tokens_ip_idx ON auth_mail_tokens (purpose, request_ip, created_at);
