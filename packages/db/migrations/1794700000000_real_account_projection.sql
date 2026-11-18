-- Up Migration

CREATE TABLE IF NOT EXISTS real_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account_uuid TEXT,
  balance_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  account_seq BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS real_positions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  volume NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS real_positions_user_idx ON real_positions (user_id);

CREATE TABLE IF NOT EXISTS real_trades (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT UNIQUE,
  trade_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  volume NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  realized_pnl_cents BIGINT,
  executed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS real_trades_user_idx ON real_trades (user_id, executed_at DESC);
