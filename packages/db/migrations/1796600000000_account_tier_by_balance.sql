-- Up Migration
--
-- Тип счёта (портфель плеча) по балансу: порог для автоматического перехода.
-- Решение владельца 26.11: при регистрации тип не выбирается, все получают
-- портфель по умолчанию; при росте реального баланса до порога портфель
-- повышается автоматически (только вверх, понижения нет).

ALTER TABLE leverage_portfolios
  ADD COLUMN IF NOT EXISTS min_balance_minor BIGINT NOT NULL DEFAULT 0
    CHECK (min_balance_minor >= 0);

-- Момент последней проверки типа счёта по балансу (берётся ДО чтения баланса,
-- чтобы зачисление между чтением и записью не потерялось).
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier_checked_at TIMESTAMPTZ;

-- Служебный оператор для журнала автоматических повышений. Войти нельзя.
INSERT INTO operators (id, login, display_name, role, disabled_at) VALUES
  ('00000000-0000-4000-8000-00000000c0b6', 'system:account-tier', 'Система · тип счёта по балансу', 'operator', now())
ON CONFLICT (login) DO NOTHING;
