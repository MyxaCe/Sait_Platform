-- Up Migration

ALTER TABLE money_commands
  ADD COLUMN IF NOT EXISTS result_code TEXT,
  ADD COLUMN IF NOT EXISTS result_detail TEXT,
  ADD COLUMN IF NOT EXISTS terminal_seq BIGINT,
  ADD COLUMN IF NOT EXISTS dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES operators(id);

CREATE INDEX IF NOT EXISTS money_commands_type_created_idx ON money_commands (type, created_at DESC);
