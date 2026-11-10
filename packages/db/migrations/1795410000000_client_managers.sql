-- Up Migration
--
-- Менеджеры клиентов (ДЕМО-менеджеры, 10.11; ADR «Функция 1» в
-- _brain/ДЕМО-менеджеры-перевод-правка-дизайн.md).
--
-- Решение: менеджер — НЕ роль, а ОТВЕТСТВЕННОСТЬ. Роль отвечает на вопрос
-- «какие разделы открыты» (матрица components/shell/sections.ts), закрепление —
-- «за чьими клиентами человек следит». Это разные оси, поэтому:
--  1. `operators.is_client_manager` — разрешение быть закреплённым за клиентом
--     (ставит admin с основанием, журнал). Доступ к разделам не меняет.
--  2. `client_managers` — текущее закрепление: один менеджер на клиента.
--     История закреплений — в неизменяемом журнале (`client.manager_assigned`/
--     `client.manager_unassigned`), а `last_journal_seq` связывает текущее
--     состояние с записью, которая его установила (как у client_blocks, Р-049).
--
-- Строки нет — у клиента нет менеджера. Снятие закрепления удаляет строку
-- (факт снятия остаётся в журнале).
--
-- Down намеренно нет — выкат вперёд (как у соседних миграций зоны, WEB-31).

ALTER TABLE operators ADD COLUMN IF NOT EXISTS is_client_manager BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS client_managers (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  manager_id UUID NOT NULL REFERENCES operators(id),
  assigned_by UUID NOT NULL REFERENCES operators(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);

CREATE INDEX IF NOT EXISTS client_managers_manager_idx ON client_managers (manager_id);
