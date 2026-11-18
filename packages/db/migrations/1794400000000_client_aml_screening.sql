-- Up Migration

CREATE TABLE IF NOT EXISTS client_aml_screening (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'unscreened' CHECK (status IN ('unscreened', 'clear', 'escalated')),
  lists_checked TEXT[] NOT NULL DEFAULT '{}',
  reason TEXT,
  screened_by UUID REFERENCES operators(id),
  screened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);

COMMENT ON TABLE client_aml_screening IS
  'Результат ручного AML-скрининга клиента (ADM-14, Р-454 I-5). Состояние комплаенса, не счёта; каждый скрининг журналируется (client.aml_checked / client.aml_escalated).';
