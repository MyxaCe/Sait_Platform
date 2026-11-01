-- Up Migration
--
-- Ручной AML-скрининг клиента (ADM-14, Р-454 I-5, Р-049). Как и состояние
-- проверки (`client_verification`, фундамент 1793449440000) и блокировка
-- (`client_blocks`, 1794100000000), результат AML-скрининга — ПЕРВОКЛАССНОЕ
-- состояние управления, а не флаг в клиентской `users` (Р-396: управление
-- держится отдельно от счёта клиента). Поэтому отдельная таблица, ключ — тот
-- же `user_id`.
--
-- На старте скрининг РУЧНОЙ (Р-454 I-5): оператор сам сверяет клиента по
-- внешним санкционным спискам (OFSI/OFAC/EU consolidated) и PEP во внешних
-- источниках, а в системе ФИКСИРУЕТ РЕЗУЛЬТАТ с основанием. Автоинтеграция
-- (ComplyAdvantage/Dow Jones/Sumsub) — позже, отдельной задачей; схема к ней
-- готова (место под провайдера — порт в `apps/admin/lib/aml/provider.ts`),
-- но живого провайдера нет.
--
-- Строка на клиента появляется по первому скринингу оператора; её отсутствие
-- читается как `unscreened` (COALESCE в запросах). `status` — исход последнего
-- скрининга; `lists_checked` — по каким спискам оператор свёл результат (его же
-- несёт запись журнала); `reason` — основание последнего скрининга (обязательно);
-- `screened_by`/`screened_at` — кто и когда свёл; `last_journal_seq` связывает
-- текущее состояние с записью журнала, которая его установила — ровно как
-- `client_verification.last_journal_seq` и `client_blocks.last_journal_seq`.
--
-- Исход — закрытый CHECK (fail-closed): `unscreened` (ещё не сводили),
-- `clear` (проверено, совпадений нет), `escalated` (найдено → эскалация).
-- Каждый скрининг журналируется той же транзакцией (`client.aml_checked` /
-- `client.aml_escalated`) — см. `apps/admin/lib/aml/screening.ts`. Деньги сюда
-- НЕ пишутся (Р-396): скрининг — состояние комплаенса, не счёта.
--
-- Down намеренно нет — как и у соседних миграций зоны (выкат вперёд, WEB-31).

CREATE TABLE IF NOT EXISTS client_aml_screening (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'unscreened' CHECK (status IN ('unscreened', 'clear', 'escalated')),
  -- По каким спискам оператор свёл результат (подмножество OFSI/OFAC/EU).
  -- Какие списки ОБЯЗАТЕЛЬНЫ — решение владельца (политика AML), в схеме не
  -- зашито; здесь только фиксируется, что оператор фактически проверил.
  lists_checked TEXT[] NOT NULL DEFAULT '{}',
  -- Основание скрининга (обязательно на уровне приложения, Р-049/Р-394).
  reason TEXT,
  screened_by UUID REFERENCES operators(id),
  screened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);

COMMENT ON TABLE client_aml_screening IS
  'Результат ручного AML-скрининга клиента (ADM-14, Р-454 I-5). Состояние комплаенса, не счёта; каждый скрининг журналируется (client.aml_checked / client.aml_escalated).';
