-- Up Migration

CREATE TABLE IF NOT EXISTS kyc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  doc_kind TEXT NOT NULL CHECK (
    doc_kind IN ('identity', 'selfie_liveness', 'address_proof', 'source_of_funds')
  ),
  storage_key TEXT NOT NULL,
  content_type TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyc_documents_user_idx ON kyc_documents (user_id);

COMMENT ON TABLE kyc_documents IS
  'KYC-документы клиента для операторского обзора (ADM-08, Р-451 п.4). Ссылки на хранилище, не байты; загрузка — сторона кабинета.';
