-- Up Migration
--
-- Фундамент центра управления (ADM-01, Р-395). Отдельная ПОВЕРХНОСТЬ
-- управления на той же базе платформы (broker_site), не отдельная база:
-- оператор и клиент живут в одном failure domain, журнал операторского
-- действия и строка клиента, которой оно касается, видны в одной
-- транзакции. Разводятся не базы, а роли — операторы держатся отдельно
-- от клиентских `users`, чтобы вход в кабинет и вход в управление нельзя
-- было спутать одной таблицей.
--
-- Журнал действий неизменяем НЕ соглашением кода, а базой (Р-049):
-- запрет UPDATE и DELETE висит триггером, поднимающим exception. Это
-- «журнал, который сам модуль править не может» — защита на уровне
-- хранилища, которая остаётся, даже когда код ошибётся или его обойдут.
-- Append-only + хеш-цепочка (prev_hash → entry_hash) делают изъятие
-- записи видимым: цепочка рвётся.
--
-- Деньги сюда НЕ пишутся (Р-396). Проверка клиента — это состояние
-- управления, а не счёта; изменить баланс отсюда нельзя, можно лишь
-- послать команду терминалу — владельцу денежной строки. Поэтому здесь
-- только `client_verification`, и ни одной денежной колонки.
--
-- Down намеренно нет — как и у соседних миграций зоны (выкат вперёд, WEB-31).

-- Операторы: отдельно от клиентских `users` (Р-395).
CREATE TABLE IF NOT EXISTS operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

-- Неизменяемый append-only журнал действий с хеш-цепочкой (Р-049).
CREATE TABLE IF NOT EXISTS admin_action_journal (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  action TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL
);

-- Запрет правки журнала на уровне базы: «журнал, который сам модуль
-- править не может» (Р-049). Функция поднимает exception, триггер
-- before update or delete не даёт ни изменить, ни удалить строку.
CREATE OR REPLACE FUNCTION admin_action_journal_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'admin_action_journal неизменяем (Р-049): % запрещён, журнал только дополняется', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_action_journal_no_change ON admin_action_journal;
CREATE TRIGGER admin_action_journal_no_change
  BEFORE UPDATE OR DELETE ON admin_action_journal
  FOR EACH ROW EXECUTE FUNCTION admin_action_journal_immutable();

-- Состояние проверки клиента — первоклассное, не флаг в `users` (Р-396:
-- это состояние управления, а не счёта). last_journal_seq связывает
-- текущее состояние с записью журнала, которая его установила.
CREATE TABLE IF NOT EXISTS client_verification (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'unverified' CHECK (state IN ('unverified', 'pending', 'verified', 'rejected')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
