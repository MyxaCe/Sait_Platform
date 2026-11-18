-- Up Migration

CREATE TABLE IF NOT EXISTS money_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'reversal', 'zeroing', 'adjustment')),
  account_id UUID NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  scale SMALLINT NOT NULL CHECK (scale >= 0),
  initiator_id UUID NOT NULL REFERENCES operators(id),
  initiator_role TEXT NOT NULL CHECK (initiator_role IN ('admin', 'finance_operator')),
  basis_ref TEXT NOT NULL,
  original_command_id UUID REFERENCES money_commands(id),
  nonce TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (
    state IN ('draft', 'awaiting_second_approval', 'signed', 'dispatched', 'executed', 'rejected')
  ),
  issued_at TIMESTAMPTZ,
  signature TEXT,
  key_version TEXT,
  break_glass BOOLEAN NOT NULL DEFAULT false,
  break_glass_reason TEXT,
  incident_ref TEXT,
  review_due_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES operators(id),
  review_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT money_commands_break_glass_reason CHECK (
    break_glass = false OR break_glass_reason IS NOT NULL
  ),
  CONSTRAINT money_commands_break_glass_incident CHECK (
    break_glass = false OR incident_ref IS NOT NULL
  ),
  CONSTRAINT money_commands_reversal_ref CHECK (
    type <> 'reversal' OR original_command_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS money_commands_state_idx ON money_commands (state);
CREATE INDEX IF NOT EXISTS money_commands_account_idx ON money_commands (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS money_commands_break_glass_incident_uniq
  ON money_commands (incident_ref) WHERE break_glass;

CREATE TABLE IF NOT EXISTS money_command_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES money_commands(id),
  approver_id UUID NOT NULL REFERENCES operators(id),
  kind TEXT NOT NULL CHECK (kind IN ('initiate', 'second_approval')),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT money_command_approvals_one_role UNIQUE (command_id, approver_id),
  CONSTRAINT money_command_approvals_one_per_kind UNIQUE (command_id, kind)
);

CREATE INDEX IF NOT EXISTS money_command_approvals_command_idx
  ON money_command_approvals (command_id);

COMMENT ON TABLE money_commands IS
  'Денежные команды ЦУ → терминал (Р-452): намерение и аудит, не баланс. Dual control + Ed25519-подпись; деньги двигает терминал (Р-396).';
COMMENT ON TABLE money_command_approvals IS
  'Аппрувы dual control денежных команд (Р-452): инициатор + второй аппрувер, разные учётки (self-approval запрещён схемой и логикой).';
