-- Up Migration

CREATE TABLE IF NOT EXISTS kyc_liveness_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL DEFAULT 'manual',
  code TEXT NOT NULL CHECK (code ~ '^[0-9]{4,8}$'),
  tasks JSONB NOT NULL CHECK (jsonb_typeof(tasks) = 'array'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  document_id UUID UNIQUE REFERENCES kyc_documents(id),
  user_agent TEXT,
  CHECK (expires_at > issued_at),
  CHECK ((used_at IS NULL) = (document_id IS NULL))
);

CREATE INDEX IF NOT EXISTS kyc_liveness_challenges_user_idx
  ON kyc_liveness_challenges (user_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS kyc_document_frames (
  document_id UUID NOT NULL REFERENCES kyc_documents(id),
  frame_index SMALLINT NOT NULL CHECK (frame_index >= 0 AND frame_index < 8),
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (document_id, frame_index)
);

COMMENT ON TABLE kyc_liveness_challenges IS
  'Задание для селфи с камеры: выдаётся сервером, одноразовое, с ограниченным сроком; проверку делает оператор по снимкам.';
COMMENT ON TABLE kyc_document_frames IS
  'Снимки с камеры, поданные одним KYC-документом selfie_liveness; файлы в том же хранилище, что и документы.';
