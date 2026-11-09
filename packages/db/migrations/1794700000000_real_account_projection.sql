-- Up Migration
--
-- Проекция РЕАЛЬНОГО счёта (решение владельца 09.11: демо и реальный счёт
-- разделены). Параллельные таблицы, а не колонка kind в demo_*:
--  * существующие таблицы и их ключи (demo_accounts PK user_id) не трогаются —
--    накат без перестройки PK и без риска для работающей демо-проекции;
--  * событие БЕЗ признака счёта (старые события, старый терминал) по-прежнему
--    идёт в demo_* прежним путём — «нет поля = демо» держится кодом
--    консюмера, а не умолчанием колонки.
-- Форма — зеркало demo_* (1785542520000, 1791245040000, 1793370360000).
-- Down намеренно нет (WEB-31).

CREATE TABLE IF NOT EXISTS real_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Идентификатор счёта у терминала (если событие его несёт).
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
