-- Up Migration
--
-- Блокировка клиента (ADM-02, Р-396, Р-049). Как и состояние проверки
-- (`client_verification`, фундамент 1793449440000), блокировка — это
-- ПЕРВОКЛАССНОЕ состояние управления, а не флаг в клиентской `users`
-- (Р-396: управление держится отдельно от счёта клиента; фундамент уже
-- вынес проверку из `users` по этой же причине). Поэтому заводим отдельную
-- таблицу, ключ — тот же `user_id`.
--
-- Строка на клиента появляется по первому решению оператора (блок/разблок);
-- её отсутствие читается как «не заблокирован» (COALESCE в запросах реестра).
-- `blocked` — текущий флаг; `reason` — основание последнего решения (его же
-- несёт запись журнала); `blocked_by` — оператор решения; `last_journal_seq`
-- связывает текущее состояние с записью журнала, которая его установила —
-- ровно как `client_verification.last_journal_seq` (Р-049).
--
-- Деньги сюда НЕ пишутся (Р-396): блокировка — состояние управления доступом,
-- а не счёта. Фактическое гашение сессий терминала — отдельная задача (долг
-- ADM-01, in-memory сессии терминала), и в схеме следа не оставляет: намерение
-- гашения журналируется в `admin_action_journal` (`client.sessions_revoked`).
--
-- Down намеренно нет — как и у соседних миграций зоны (выкат вперёд, WEB-31).

CREATE TABLE IF NOT EXISTS client_blocks (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  blocked BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  blocked_by UUID REFERENCES operators(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
