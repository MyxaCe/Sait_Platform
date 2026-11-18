-- Up Migration
ALTER TABLE demo_accounts ADD COLUMN IF NOT EXISTS account_seq BIGINT;
