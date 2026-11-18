-- Up Migration

ALTER TABLE operators ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE operators ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;

COMMENT ON COLUMN operators.totp_secret IS
  'Секрет TOTP (base32, RFC 4648) второго фактора (Р-454 III-3). NULL = 2FA не настроена.';
COMMENT ON COLUMN operators.totp_enrolled_at IS
  'Момент подтверждения TOTP верным кодом. NULL, пока 2FA не включена.';
