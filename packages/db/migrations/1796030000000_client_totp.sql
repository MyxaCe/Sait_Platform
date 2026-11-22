-- Up Migration
--
-- Необязательная 2FA клиента (TOTP). Секрет хранится зашифрованным
-- (AES-256-GCM, ключ CABINET_TOTP_KEY). enabled_at NULL — настройка начата,
-- но не подтверждена кодом: такая строка 2FA не включает.
-- Down намеренно нет — выкат вперёд (WEB-31).

CREATE TABLE IF NOT EXISTS client_totp (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_at TIMESTAMPTZ,
  last_counter BIGINT,
  failed_attempts INT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS client_totp_recovery_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  UNIQUE (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS client_login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS client_login_challenges_user_idx ON client_login_challenges (user_id);
