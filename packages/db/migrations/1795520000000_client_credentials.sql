-- Up Migration
--
-- Ручная правка учётных данных клиента менеджером (ДЕМО, функция 3; решения
-- владельца 10.11 — см. «Решения владельца 10.11» в
-- _brain/ДЕМО-менеджеры-перевод-правка-дизайн.md).
--
-- Модель упрощена владельцем: правку проводит сам менеджер клиента (или
-- admin), без второго утверждающего. Поэтому отдельной таблицы «запросов на
-- изменение» НЕТ: каждое изменение — одна транзакция «состояние + запись в
-- неизменяемый журнал» (`client.credentials.*`), а история вкладки «Учётные
-- данные» и счётчик необычной активности читаются из журнала.
--
-- Новых сущностей для заморозки вывода не заводим: это тот же флаг «Запрет
-- вывода» (`client_money_flags.withdraw_banned`), который уже учитывает
-- `resolveMoneyPolicy`. Добавлены только срок и происхождение запрета.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

-- 1. Временный пароль: при входе клиент обязан сменить пароль; срок жизни
--    временного пароля ограничен (после — вход им невозможен).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ;

-- 2. «Запрет вывода» со сроком и происхождением.
--    withdraw_ban_until NULL — бессрочно (как было);
--    withdraw_ban_kind: money_flags — поставлен в «Денежных флагах» (финансы/
--    admin; NULL у старых строк значит то же), credentials_manual — менеджер
--    по своему распоряжению, credentials_auto — автозаморозка после смены
--    учётных данных. Менеджер снимает только запреты credentials_*.
--    Действующий запрет = withdraw_banned AND (until IS NULL OR until > now()).
ALTER TABLE client_money_flags ADD COLUMN IF NOT EXISTS withdraw_ban_until TIMESTAMPTZ;
ALTER TABLE client_money_flags ADD COLUMN IF NOT EXISTS withdraw_ban_kind TEXT;
ALTER TABLE client_money_flags ADD COLUMN IF NOT EXISTS withdraw_ban_reason TEXT;
ALTER TABLE client_money_flags DROP CONSTRAINT IF EXISTS client_money_flags_withdraw_ban_kind_check;
ALTER TABLE client_money_flags
  ADD CONSTRAINT client_money_flags_withdraw_ban_kind_check
  CHECK (withdraw_ban_kind IS NULL OR withdraw_ban_kind IN ('money_flags', 'credentials_manual', 'credentials_auto'));

-- 3. Уведомления клиенту о смене учётных данных («ваш email изменён
--    менеджером…», «выдан временный пароль…») — через ту же очередь писем.
ALTER TABLE outbound_mail DROP CONSTRAINT IF EXISTS outbound_mail_purpose_check;
ALTER TABLE outbound_mail
  ADD CONSTRAINT outbound_mail_purpose_check
  CHECK (purpose IN ('support_reply', 'support_ack', 'password_reset', 'email_verify', 'credentials_notice'));

-- 4. Настройки безопасности учётных данных: синглтон на базу (= на ячейку),
--    как platform_money_settings.
CREATE TABLE IF NOT EXISTS platform_credential_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Чек-лист проверки личности: [{ "id": "...", "label": "...", "required": bool }].
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Сколько пунктов минимум отметить (кроме обязательных).
  min_checked INT NOT NULL DEFAULT 1 CHECK (min_checked BETWEEN 0 AND 20),
  -- Автозаморозка вывода после смены email / временного пароля.
  auto_hold_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_hold_hours INT NOT NULL DEFAULT 24 CHECK (auto_hold_hours BETWEEN 1 AND 720),
  -- Алерт службе безопасности: больше N правок одним оператором за сутки.
  alert_per_operator_day INT NOT NULL DEFAULT 5 CHECK (alert_per_operator_day BETWEEN 1 AND 1000),
  -- Срок жизни временного пароля.
  temp_password_hours INT NOT NULL DEFAULT 24 CHECK (temp_password_hours BETWEEN 1 AND 168),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
INSERT INTO platform_credential_settings (id, checklist) VALUES (1, '[
  {"id": "video_call", "label": "Видеозвонок: лицо сверено с селфи и документом KYC", "required": false},
  {"id": "document_match", "label": "Документ клиента совпадает с данными KYC (тип, номер, срок)", "required": false},
  {"id": "account_questions", "label": "Ответы о счёте: сумма и дата последнего депозита, дата регистрации", "required": false},
  {"id": "known_channel", "label": "Обращение с известного канала (прежний email, телефон, страна входа)", "required": false}
]'::jsonb) ON CONFLICT (id) DO NOTHING;

-- 5. Счётчик необычной активности и история вкладки читают журнал по коду
--    действия — частичный индекс по правкам учётных данных.
CREATE INDEX IF NOT EXISTS admin_action_journal_credentials_idx
  ON admin_action_journal (occurred_at, operator_id)
  WHERE action LIKE 'client.credentials.%';
