-- Up Migration

CREATE TABLE IF NOT EXISTS client_blocks (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  blocked BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  blocked_by UUID REFERENCES operators(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
