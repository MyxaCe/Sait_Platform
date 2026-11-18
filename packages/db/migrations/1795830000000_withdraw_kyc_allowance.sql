-- Up Migration

ALTER TABLE platform_money_settings
  ADD COLUMN IF NOT EXISTS unverified_withdraw_bps INTEGER NOT NULL DEFAULT 500
    CHECK (unverified_withdraw_bps BETWEEN 0 AND 10000);

ALTER TABLE client_money_flags
  ADD COLUMN IF NOT EXISTS unverified_withdraw_bps INTEGER
    CHECK (unverified_withdraw_bps IS NULL OR unverified_withdraw_bps BETWEEN 0 AND 10000);
