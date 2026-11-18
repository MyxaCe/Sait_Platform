-- Up Migration

CREATE TABLE IF NOT EXISTS auth_mail_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
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
