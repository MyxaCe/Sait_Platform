-- Up Migration
--
-- Режимы вывода (решение владельца 23.11, проект docs/site/вывод-ручной-режим.md).
--
-- withdraw_mode — один переключатель на всю платформу:
--   manual — как сейчас: оператор одобряет, отправляет USDT сам и вносит хэш;
--   auto   — пока равен manual (исполнителя автоотправки нет; этап 2);
--   stop   — аварийный «Стоп»: заявки принимаются и деньги удерживаются, но
--            «Одобрить» и «Отправлено» запрещены всем, включая admin.
--            Проверка — на сервере, внутри транзакции смены статуса
--            (SELECT … FOR SHARE строки настроек против FOR UPDATE переключателя).
-- По умолчанию manual — ровно текущее поведение.
--
-- client_money_flags.withdraw_manual_only — «только ручной вывод» у клиента.
-- На этапе 1 сохраняется и показывается; поведение начнёт менять исполнитель
-- автоотправки (этап 2), который такие заявки пропустит.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

ALTER TABLE platform_money_settings
  ADD COLUMN IF NOT EXISTS withdraw_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (withdraw_mode IN ('auto', 'manual', 'stop')),
  ADD COLUMN IF NOT EXISTS withdraw_mode_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdraw_mode_changed_by UUID REFERENCES operators(id);

INSERT INTO platform_money_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE client_money_flags
  ADD COLUMN IF NOT EXISTS withdraw_manual_only BOOLEAN NOT NULL DEFAULT false;
