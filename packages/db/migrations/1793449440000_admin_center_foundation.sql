-- Up Migration

CREATE TABLE IF NOT EXISTS operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_action_journal (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  action TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION admin_action_journal_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'admin_action_journal неизменяем (Р-049): % запрещён, журнал только дополняется', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_action_journal_no_change ON admin_action_journal;
CREATE TRIGGER admin_action_journal_no_change
  BEFORE UPDATE OR DELETE ON admin_action_journal
  FOR EACH ROW EXECUTE FUNCTION admin_action_journal_immutable();

CREATE TABLE IF NOT EXISTS client_verification (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'unverified' CHECK (state IN ('unverified', 'pending', 'verified', 'rejected')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
