-- Up Migration
--
-- Перевод клиента на другую платформу группы (ДЕМО-менеджеры, функция 2;
-- решения владельца 10.11 — _brain/ДЕМО-менеджеры-перевод-правка-дизайн.md §2.0
-- и «Решения владельца 10.11 — перевод»).
--
-- Модель «ячейка на платформу»: у каждой платформы своя база, юрлицо и
-- кошелёк. Поэтому таблицы ниже есть в КАЖДОЙ ячейке, и каждая ячейка в
-- переводе играет одну из ролей:
--  * источник — `platform_transfers` (исходящие переводы своих клиентов);
--  * цель    — `platform_transfers_inbound` (приглашения, НЕ счета).
-- Связь между ячейками — только подписанные Ed25519 сообщения по внутреннему
-- API (`platform_transfer_outbox` → HTTP → приёмник). База в базу не ходит.
--
-- Инициатива клиента — ТОЛЬКО тикет поддержки, первое сообщение которого
-- написал сам клиент (решение владельца 10.11). Согласие на передачу данных —
-- ссылка на конкретное сообщение клиента в этом тикете. Одобрения admin нет:
-- менеджер проводит перевод сам, admin видит его постфактум и может
-- «Вернуть перевод» (revoked).
--
-- Денег здесь нет: внутреннего переноса баланса между юрлицами не бывает —
-- только вывод из источника и депозит в цель самим клиентом.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

-- Системный автор журнала для переходов, которые делает межплатформенный
-- канал (приём пакета, приглашение, статусы цели). Войти нельзя.
INSERT INTO operators (id, login, display_name, role, disabled_at) VALUES
  ('00000000-0000-4000-8000-00000000c0b5', 'system:platform-transfer', 'Система · переводы между платформами', 'operator', now())
ON CONFLICT (login) DO NOTHING;

-- Письма перевода идут через общую очередь `outbound_mail` (воркер поддержки):
-- приглашение цели (одноразовая ссылка — тело стирается после отправки) и
-- уведомление клиенту при возврате перевода.
-- Список — НАДМНОЖЕСТВО предыдущей миграции 1795520000000_client_credentials
-- (credentials_notice): CHECK переопределяется целиком, потерять чужое
-- назначение нельзя (сведено в integration-demo4).
ALTER TABLE outbound_mail DROP CONSTRAINT IF EXISTS outbound_mail_purpose_check;
ALTER TABLE outbound_mail
  ADD CONSTRAINT outbound_mail_purpose_check
  CHECK (purpose IN ('support_reply', 'support_ack', 'password_reset', 'email_verify', 'credentials_notice',
                     'transfer_invite', 'transfer_notice'));

-- ── Реестр платформ группы (настройка ячейки, не хардкод) ─────────────────
-- Своя платформа — строка со slug = SITE_SLUG процесса. Приватного ключа
-- здесь НЕТ (он только в env ячейки); публичные ключи соседей — здесь.
CREATE TABLE IF NOT EXISTS group_platforms (
  slug TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  legal_entity TEXT,
  regulator TEXT,
  -- Публичный адрес кабинета (ссылки клиенту: приглашение, регистрация).
  cabinet_url TEXT NOT NULL CHECK (cabinet_url ~ '^https?://'),
  -- Внутренний адрес межплатформенного API (сеть back), напр.
  -- http://broker-admin-nordex-eu:3005. NULL — платформа не принимает сообщения.
  api_url TEXT CHECK (api_url IS NULL OR api_url ~ '^https?://'),
  -- Публичный ключ подписи (Ed25519, SPKI PEM).
  public_key_pem TEXT CHECK (public_key_pem IS NULL OR public_key_pem LIKE '-----BEGIN PUBLIC KEY-----%'),
  -- Профиль юрисдикции (подсказки и жёсткие запреты направлений).
  eu_license BOOLEAN NOT NULL DEFAULT false,
  -- Пусто — обслуживает все страны, кроме запрещённых.
  served_countries TEXT[] NOT NULL DEFAULT '{}',
  forbidden_countries TEXT[] NOT NULL DEFAULT '{}',
  max_retail_leverage INT CHECK (max_retail_leverage IS NULL OR max_retail_leverage BETWEEN 1 AND 3000),
  bonuses_allowed BOOLEAN NOT NULL DEFAULT false,
  -- Принимает ли платформа входящие переводы (выключено — направление закрыто).
  accepts_transfers BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);

-- ── Источник: исходящие переводы ─────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS platform_transfer_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS platform_transfers (
  -- transfer_id — общий для обеих ячеек (в цели — PK входящего).
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Общий номер перевода, видимый в обеих платформах: «TR-apex-ru-1001».
  number TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  source_platform TEXT NOT NULL,
  target_platform TEXT NOT NULL REFERENCES group_platforms(slug),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN (
    'sent',          -- проведён менеджером, пакет в очереди доставки
    'delivered',     -- цель приняла пакет (приглашение создано)
    'invited',       -- письмо-приглашение ушло клиенту
    'registered',    -- клиент сам зарегистрировался в цели
    'kyc_passed',    -- клиент прошёл KYC в цели
    'source_closed', -- счёт в источнике закрыт по переводу (заморожен)
    'refused',       -- цель отказала (направление/подпись) — окончательно
    'expired',       -- клиент не зарегистрировался в срок
    'revoked'        -- admin вернул перевод
  )),
  initiator_id UUID NOT NULL REFERENCES operators(id),
  -- Доказательство инициативы: тикет, первое сообщение которого — от клиента.
  evidence_ticket_id UUID NOT NULL REFERENCES support_tickets(id),
  evidence_message_id UUID NOT NULL REFERENCES support_messages(id),
  evidence_sha256 TEXT NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- Согласие на передачу данных: сообщение клиента в том же тикете.
  consent_message_id UUID NOT NULL REFERENCES support_messages(id),
  consent_text_version TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  basis TEXT NOT NULL CHECK (length(btrim(basis)) > 0),
  -- Подсказки профилей юрисдикций на момент проведения (что видел менеджер).
  jurisdiction_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  package_sha256 TEXT,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending', 'delivered', 'refused', 'cancelled')),
  delivery_error TEXT,
  delivered_at TIMESTAMPTZ,
  target_invited_at TIMESTAMPTZ,
  target_registered_at TIMESTAMPTZ,
  target_kyc_passed_at TIMESTAMPTZ,
  -- Закрытие счёта в источнике (действие менеджера с основанием).
  source_closed_at TIMESTAMPTZ,
  source_closed_by UUID REFERENCES operators(id),
  source_close_basis TEXT,
  -- Состояние клиента ДО закрытия (для восстановления при возврате).
  source_close_prev_frozen BOOLEAN,
  -- Возврат перевода (admin, постфактум).
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES operators(id),
  revoke_basis TEXT,
  revoke_stage TEXT CHECK (revoke_stage IS NULL OR revoke_stage IN ('before_registration', 'after_registration')),
  -- Что подтвердила цель по возврату: приглашение отозвано / счёт заморожен.
  revoke_applied_at TIMESTAMPTZ,
  revoke_target_detail JSONB,
  -- Восстановление клиента в источнике при возврате (снятие заморозки закрытия).
  restore_state TEXT NOT NULL DEFAULT 'none' CHECK (restore_state IN ('none', 'pending', 'done')),
  -- Уведомление admin: перевод виден постфактум, отметка «просмотрено».
  admin_seen_at TIMESTAMPTZ,
  admin_seen_by UUID REFERENCES operators(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT platform_transfers_not_self CHECK (source_platform <> target_platform),
  CONSTRAINT platform_transfers_revoked_has_basis CHECK (
    status <> 'revoked' OR (revoked_by IS NOT NULL AND length(btrim(coalesce(revoke_basis, ''))) > 0)
  )
);
CREATE INDEX IF NOT EXISTS platform_transfers_user_idx ON platform_transfers (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_transfers_initiator_idx ON platform_transfers (initiator_id, created_at DESC);
-- Один живой перевод на клиента и одно заявление (тикет) на один перевод.
CREATE UNIQUE INDEX IF NOT EXISTS platform_transfers_one_live_per_user
  ON platform_transfers (user_id) WHERE status NOT IN ('refused', 'expired', 'revoked');
CREATE UNIQUE INDEX IF NOT EXISTS platform_transfers_ticket_once
  ON platform_transfers (evidence_ticket_id) WHERE status NOT IN ('refused', 'expired', 'revoked');

-- ── Цель: входящие переводы (приглашения) ────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_transfers_inbound (
  transfer_id UUID PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  source_platform TEXT NOT NULL REFERENCES group_platforms(slug),
  package_sha256 TEXT NOT NULL CHECK (package_sha256 ~ '^[0-9a-f]{64}$'),
  -- Только поля по согласию клиента (минимизация, GDPR ст. 5(1)(c)).
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT,
  locale TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'en')),
  source_kyc_state TEXT,
  source_kyc_at TIMESTAMPTZ,
  evidence_sha256 TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  consent_text_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'invited', 'registered', 'kyc_passed', 'expired', 'revoked')),
  -- Ссылка регистрации: в базе только sha256 токена (дамп не даёт ссылок).
  invite_token_hash TEXT UNIQUE,
  invite_expires_at TIMESTAMPTZ NOT NULL,
  invite_mail_id UUID REFERENCES outbound_mail(id),
  invited_at TIMESTAMPTZ,
  registered_user_id UUID UNIQUE REFERENCES users(id),
  registered_at TIMESTAMPTZ,
  kyc_passed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_basis TEXT,
  -- Возврат после регистрации: заморозка счёта в цели (терминал — повтором).
  freeze_state TEXT NOT NULL DEFAULT 'none' CHECK (freeze_state IN ('none', 'pending', 'applied')),
  -- Клиент уже пополнил цель → задача менеджеру цели вернуть средства выводом.
  refund_task TEXT NOT NULL DEFAULT 'none' CHECK (refund_task IN ('none', 'open', 'done')),
  refund_task_done_by UUID REFERENCES operators(id),
  refund_task_done_at TIMESTAMPTZ,
  refund_task_note TEXT,
  admin_seen_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
CREATE INDEX IF NOT EXISTS platform_transfers_inbound_status_idx ON platform_transfers_inbound (status, received_at DESC);

-- ── Канал: исходящие сообщения (обе роли) ────────────────────────────────
-- Тело хранится НЕподписанным: подпись, nonce и время ставятся при каждой
-- попытке (ключ — только в env процесса-отправителя). Идемпотентность у
-- получателя — по transfer_id + типу + событию, а не по nonce.
CREATE TABLE IF NOT EXISTS platform_transfer_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL,
  to_platform TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transfer.package', 'transfer.revoke', 'transfer.status')),
  data JSONB NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sending', 'delivered', 'refused', 'failed', 'cancelled')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  response_code TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_transfer_outbox_due_idx ON platform_transfer_outbox (next_attempt_at) WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS platform_transfer_outbox_transfer_idx ON platform_transfer_outbox (transfer_id, created_at);

-- ── Канал: приём (обе роли) ──────────────────────────────────────────────
-- Защита от повтора перехваченного сообщения: nonce одноразовый.
CREATE TABLE IF NOT EXISTS platform_transfer_nonces (
  nonce TEXT PRIMARY KEY,
  from_platform TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Идемпотентность обработанных событий (статус/возврат).
CREATE TABLE IF NOT EXISTS platform_transfer_inbox (
  dedupe_key TEXT PRIMARY KEY,
  transfer_id UUID NOT NULL,
  kind TEXT NOT NULL,
  from_platform TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
