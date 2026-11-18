-- Up Migration

ALTER TABLE operators ADD COLUMN IF NOT EXISTS is_client_manager BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS client_managers (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  manager_id UUID NOT NULL REFERENCES operators(id),
  assigned_by UUID NOT NULL REFERENCES operators(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);

CREATE INDEX IF NOT EXISTS client_managers_manager_idx ON client_managers (manager_id);
