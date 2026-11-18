-- Up Migration

CREATE TABLE IF NOT EXISTS leverage_portfolios (
  key           TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  base_leverage INT  NOT NULL CHECK (base_leverage >= 1),
  is_default    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leverage_portfolios_one_default
  ON leverage_portfolios ((is_default)) WHERE is_default;

CREATE TABLE IF NOT EXISTS leverage_portfolio_class_overrides (
  portfolio_key    TEXT NOT NULL REFERENCES leverage_portfolios(key) ON DELETE CASCADE,
  instrument_class TEXT NOT NULL,
  leverage         INT  NOT NULL CHECK (leverage >= 1),
  PRIMARY KEY (portfolio_key, instrument_class)
);

CREATE TABLE IF NOT EXISTS client_leverage (
  user_id           UUID PRIMARY KEY REFERENCES users(id),
  portfolio_key     TEXT NOT NULL REFERENCES leverage_portfolios(key),
  override_leverage INT  CHECK (override_leverage IS NULL OR override_leverage >= 1),
  override_reason   TEXT,
  override_ticket   TEXT,
  override_by       UUID REFERENCES operators(id),
  override_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq  BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT client_leverage_override_all_or_none CHECK (
    (override_leverage IS NULL AND override_reason IS NULL AND override_ticket IS NULL
       AND override_by IS NULL AND override_at IS NULL)
    OR
    (override_leverage IS NOT NULL AND override_reason IS NOT NULL AND override_ticket IS NOT NULL
       AND override_by IS NOT NULL AND override_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS client_leverage_portfolio_idx ON client_leverage (portfolio_key);

INSERT INTO leverage_portfolios (key, title, base_leverage, is_default, sort_order) VALUES
  ('standard',  'Standard',  20,  true,  10),
  ('pro',       'Pro',       50,  false, 20),
  ('enc_prime', 'ENC Prime', 100, false, 30)
ON CONFLICT (key) DO NOTHING;

INSERT INTO leverage_portfolio_class_overrides (portfolio_key, instrument_class, leverage) VALUES
  ('standard', 'crypto', 10)
ON CONFLICT (portfolio_key, instrument_class) DO NOTHING;
