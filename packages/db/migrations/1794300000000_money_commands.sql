-- Up Migration
--
-- Денежные команды центра управления → терминал (Р-452). Стратегическое ядро и
-- ДЕНЬГИ: dual control, подпись Ed25519, журнал команд. Полный дизайн —
-- `_brain/money-команды-дизайн.md`.
--
-- Деньги здесь НЕ двигаются (Р-396). Эта таблица — НАМЕРЕНИЕ и его аудит:
-- команда есть подписанное распоряжение терминалу, а владелец денежной строки —
-- терминал. Ни одной денежной колонки баланса здесь нет; `amount_minor` — это
-- величина РАСПОРЯЖЕНИЯ, не баланс.
--
-- Журнал команд — append-only, неизменяем ХРАНИЛИЩЕМ (Р-452, тот же принцип, что
-- `admin_action_journal`). Отдельной таблицы журнала команд НЕ заводим: каждый
-- переход пишется в `admin_action_journal` (subject_kind='money_command'),
-- который уже неизменяем триггером и сцеплен хеш-цепочкой (Р-049). Привязка
-- текущего состояния к записи журнала — `last_journal_seq`.
--
-- Денежная ВЕЛИЧИНА — только целое в минорных единицах (`amount_minor BIGINT`) +
-- валюта + точность (`scale`). Никаких float: деньги не в double.
--
-- Dual control (Р-452): команда выше порога (конфиг; старт — любая) требует
-- второго аппрувера, ОТЛИЧНОГО от инициатора. Запрет self-approval стоит и в
-- логике, и здесь: партиальный UNIQUE по (command_id, approver_id) не даёт
-- одному оператору занять обе роли одной команды.
--
-- Приватный ключ подписи — только у ЦУ (Р-452); здесь хранится лишь РЕЗУЛЬТАТ
-- подписи (`signature`) и версия ключа (`key_version`) для ротации. Секретов в
-- базе нет.
--
-- Down намеренно нет — как и у соседних миграций зоны (выкат вперёд, WEB-31).

CREATE TABLE IF NOT EXISTS money_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Тип по Р-452 (закрытый CHECK, fail-closed): неизвестный тип не пишется.
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'reversal', 'zeroing', 'adjustment')),
  -- Счёт-субъект. UUID; FK намеренно нет — счёт живёт на стороне терминала,
  -- а не в операторской базе (Р-396: деньги не здесь).
  account_id UUID NOT NULL,
  -- Денежная тройка: величина распоряжения в минорных единицах, валюта, точность.
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  scale SMALLINT NOT NULL CHECK (scale >= 0),
  -- Инициатор — оператор ЦУ (из сессии, не из формы, Р-452).
  initiator_id UUID NOT NULL REFERENCES operators(id),
  -- Основание: id заявки/тикета/инцидента. Непустое.
  basis_ref TEXT NOT NULL,
  -- Одноразовый маркер против повтора. UNIQUE — наша сторона тоже не допускает
  -- повтор (кэш nonce терминала — отдельно, его сторона).
  nonce TEXT NOT NULL UNIQUE,
  -- Стейт-машина dual control (Р-452).
  state TEXT NOT NULL DEFAULT 'draft' CHECK (
    state IN ('draft', 'awaiting_second_approval', 'signed', 'dispatched', 'executed', 'rejected')
  ),
  -- Метка времени выпуска — ставится при подписи (дизайн §1), до тех пор NULL.
  issued_at TIMESTAMPTZ,
  -- Результат подписи ЦУ (base64) и версия ключа (ротация). До подписи NULL.
  signature TEXT,
  key_version TEXT,
  -- Break-glass (Р-452): аварийный обход dual control, с причиной, ревью ≤24ч.
  break_glass BOOLEAN NOT NULL DEFAULT false,
  break_glass_reason TEXT,
  review_due_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES operators(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Запись журнала, установившая текущее состояние (та же транзакция).
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  -- break-glass обязан нести причину (fail-closed на уровне схемы).
  CONSTRAINT money_commands_break_glass_reason CHECK (
    break_glass = false OR break_glass_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS money_commands_state_idx ON money_commands (state);
CREATE INDEX IF NOT EXISTS money_commands_account_idx ON money_commands (account_id);

-- Аппрувы dual control: кто и в какой роли авторизовал команду (Р-452).
CREATE TABLE IF NOT EXISTS money_command_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES money_commands(id),
  approver_id UUID NOT NULL REFERENCES operators(id),
  kind TEXT NOT NULL CHECK (kind IN ('initiate', 'second_approval')),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Один оператор — одна роль на команду: запрет self-approval в схеме
  -- (инициатор не может ещё и подтвердить). Подпора к логическому гарду.
  CONSTRAINT money_command_approvals_one_role UNIQUE (command_id, approver_id),
  -- Не больше одного аппрува каждого рода на команду.
  CONSTRAINT money_command_approvals_one_per_kind UNIQUE (command_id, kind)
);

CREATE INDEX IF NOT EXISTS money_command_approvals_command_idx
  ON money_command_approvals (command_id);

COMMENT ON TABLE money_commands IS
  'Денежные команды ЦУ → терминал (Р-452): намерение и аудит, не баланс. Dual control + Ed25519-подпись; деньги двигает терминал (Р-396).';
COMMENT ON TABLE money_command_approvals IS
  'Аппрувы dual control денежных команд (Р-452): инициатор + второй аппрувер, разные учётки (self-approval запрещён схемой и логикой).';
