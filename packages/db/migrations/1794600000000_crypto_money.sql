-- Up Migration
--
-- Реальные деньги USDT TRC20 (дизайн «ДЕМО-USDT-TRC20», решения владельца 09.11).
--
-- Деньги здесь НЕ хранятся (Р-396): владелец денежного числа — терминал
-- (реальный счёт, internal-маршруты). Эти таблицы — заявки, их статусы и
-- настройки допуска; каждое изменение журналируется той же транзакцией
-- (`admin_action_journal`, Р-049), `last_journal_seq` связывает состояние с
-- установившей записью.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

-- Системные авторы журнала. Журнал требует `operator_id` (NOT NULL, FK).
-- Переходы, которые делает клиент (заявка из кабинета) или наблюдатель сети,
-- пишутся от имени системных учёток. Войти ими нельзя: пароля нет (NULL =
-- входа нет, Р-394) и учётка отключена. Логин с префиксом `system:` —
-- bootstrap первого админа их не считает.
INSERT INTO operators (id, login, display_name, role, disabled_at) VALUES
  ('00000000-0000-4000-8000-00000000c0b1', 'system:cabinet', 'Система · кабинет клиента', 'operator', now()),
  ('00000000-0000-4000-8000-00000000c0b2', 'system:chain-watcher', 'Система · наблюдатель сети', 'operator', now())
ON CONFLICT (login) DO NOTHING;

-- Настройки платформы: одна строка на базу = на тенант. База `broker_site`
-- принадлежит одному тенанту (консюмер отбрасывает чужой тенант), поэтому
-- синглтон (CHECK id = 1), а не ключ по слагу: расхождение слагов между
-- сервисами молча отключило бы настройки.
CREATE TABLE IF NOT EXISTS platform_money_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  deposit_requires_kyc BOOLEAN NOT NULL DEFAULT false,
  withdraw_requires_kyc BOOLEAN NOT NULL DEFAULT true,
  -- Минимумы в центах USD (1 USDT = 100 центов на счёте).
  min_deposit_minor BIGINT NOT NULL DEFAULT 1000 CHECK (min_deposit_minor >= 0),
  min_withdraw_minor BIGINT NOT NULL DEFAULT 1000 CHECK (min_withdraw_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
INSERT INTO platform_money_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Денежные флаги клиента. KYC-гейт: inherit — как в платформе;
-- required / not_required — индивидуально. frozen — «Заморозка счёта»
-- (реальный счёт: нет торговли и вывода; закрытие позиций и стоп-аут
-- работают на стороне терминала). withdraw_banned — «Запрет вывода».
CREATE TABLE IF NOT EXISTS client_money_flags (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  deposit_kyc TEXT NOT NULL DEFAULT 'inherit' CHECK (deposit_kyc IN ('inherit', 'required', 'not_required')),
  withdraw_kyc TEXT NOT NULL DEFAULT 'inherit' CHECK (withdraw_kyc IN ('inherit', 'required', 'not_required')),
  frozen BOOLEAN NOT NULL DEFAULT false,
  withdraw_banned BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);

-- Депозиты USDT TRC20. Один хэш = одно зачисление навсегда: UNIQUE(tx_hash)
-- здесь + external_ref `tron:<hash>` в терминале. user_id NULL — неопознанное
-- поступление (наблюдатель видел, никто не заявил).
CREATE TABLE IF NOT EXISTS crypto_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  tx_hash TEXT NOT NULL CHECK (tx_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'credited', 'rejected', 'unidentified')),
  from_address TEXT,
  to_address TEXT,
  -- Сумма в сырых единицах токена (USDT: 6 знаков) — как в сети.
  amount_raw NUMERIC(40, 0),
  -- Зачислено на счёт, центы. Дробь меньше цента отброшена вниз (dust_raw).
  amount_minor BIGINT,
  dust_raw NUMERIC(40, 0),
  block_time TIMESTAMPTZ,
  reject_reason TEXT,
  -- Последняя заметка наблюдателя (почему ещё ждём).
  check_note TEXT,
  last_checked_at TIMESTAMPTZ,
  terminal_seq BIGINT,
  credited_at TIMESTAMPTZ,
  -- Кто привязал неопознанное к клиенту.
  resolved_by UUID REFERENCES operators(id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT crypto_deposits_tx_hash_uniq UNIQUE (tx_hash),
  CONSTRAINT crypto_deposits_claim_has_user CHECK (status = 'unidentified' OR user_id IS NOT NULL),
  CONSTRAINT crypto_deposits_credited_amount CHECK (status <> 'credited' OR amount_minor IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS crypto_deposits_status_idx ON crypto_deposits (status);
CREATE INDEX IF NOT EXISTS crypto_deposits_user_idx ON crypto_deposits (user_id, claimed_at DESC);

-- Выводы USDT TRC20 (ручная отправка владельцем, ключей на сервере нет).
-- requested -> approved -> sent -> settled | needs_review;
-- requested -> rejected (возврат); approved / needs_review -> cancelled (возврат).
-- debit_state — списание в терминале на подаче (wd:<id>): pending (исход
-- неизвестен — терминал не ответил), debited, refused (отказ: нет маржи).
CREATE TABLE IF NOT EXISTS crypto_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  to_address TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL CHECK (
    status IN ('requested', 'approved', 'sent', 'settled', 'needs_review', 'rejected', 'cancelled')
  ),
  debit_state TEXT NOT NULL DEFAULT 'pending' CHECK (debit_state IN ('pending', 'debited', 'refused')),
  debit_seq BIGINT,
  refund_seq BIGINT,
  refunded_at TIMESTAMPTZ,
  reject_reason TEXT,
  payout_tx_hash TEXT CHECK (payout_tx_hash IS NULL OR payout_tx_hash ~ '^[0-9a-f]{64}$'),
  review_reason TEXT,
  check_note TEXT,
  last_checked_at TIMESTAMPTZ,
  decided_by UUID REFERENCES operators(id),
  sent_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT crypto_withdrawals_payout_uniq UNIQUE (payout_tx_hash),
  CONSTRAINT crypto_withdrawals_sent_has_hash CHECK (
    status NOT IN ('sent', 'settled') OR payout_tx_hash IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS crypto_withdrawals_status_idx ON crypto_withdrawals (status);
CREATE INDEX IF NOT EXISTS crypto_withdrawals_user_idx ON crypto_withdrawals (user_id, requested_at DESC);
