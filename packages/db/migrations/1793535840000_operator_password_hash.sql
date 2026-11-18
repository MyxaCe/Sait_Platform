-- Up Migration

ALTER TABLE operators ADD COLUMN IF NOT EXISTS password_hash TEXT;

COMMENT ON COLUMN operators.password_hash IS
  'argon2id PHC-строка (Р-451). NULL = входа нет (fail-closed, Р-394).';
