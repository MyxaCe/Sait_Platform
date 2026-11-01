-- Up Migration
--
-- Плечо — свойство ПОРТФЕЛЯ, не инструмента и не площадки (Р-446, WEB-44/45/46/47).
--
-- Гранулярность плеча — портфель. Портфель — атрибут клиента; три стартовых
-- (Standard 1:20 / Pro 1:50 / ENC Prime 1:100 — числа КОНФИГУРИРУЕМЫЕ, не
-- бетон, утверждаются по итогам показа). Класс инструмента остаётся ровно в
-- ОДНОМ месте — как override внутри портфеля (крипте нужна своя планка). Нужды
-- в «классе» как самостоятельной сущности больше нет (Р-446).
--
-- Разрешение плеча на открытии (пишется снимком в позицию СТОРОНОЙ ТЕРМИНАЛА,
-- TRM-49/50/53): override клиента › override класса в портфеле › плечо
-- портфеля. Эта таблица хранит ИСХОДНИКИ разрешения; сам резолв — чистая
-- функция `lib/leverage/resolve.ts` (один закон на обе стороны).
--
-- Как и соседние таблицы управления (`client_verification`, `client_blocks`):
-- это состояние УПРАВЛЕНИЯ, а не счёта (Р-396). Деньги сюда НЕ пишутся. Смена
-- портфеля клиента и выдача override — по журналу (`admin_action_journal`,
-- Р-049): `last_journal_seq` связывает текущее состояние с записью, которая
-- его установила — ровно как у `client_blocks`.
--
-- Плечо хранится как ЗНАМЕНАТЕЛЬ 1:N (целое ≥ 1): 1:20 → 20. Одно 1:1 (=20)
-- читается тривиально, модель денег не трогается (WEB-43 закрыт, Р-448).
--
-- Down намеренно нет — как и у соседних миграций зоны (выкат вперёд, WEB-31).

-- Портфель плеча. `key` — стабильный идентификатор (не UUID: портфелей мало,
-- их называют люди и код). `base_leverage` меняется админкой ГЛОБАЛЬНО для
-- всех клиентов портфеля (WEB-47). `is_default` — портфель нового клиента.
CREATE TABLE IF NOT EXISTS leverage_portfolios (
  key           TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  base_leverage INT  NOT NULL CHECK (base_leverage >= 1),
  is_default    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ровно один портфель по умолчанию: частичный уникальный индекс не даёт
-- завести второй default молча (новый клиент обязан попасть в ОДИН портфель).
CREATE UNIQUE INDEX IF NOT EXISTS leverage_portfolios_one_default
  ON leverage_portfolios ((is_default)) WHERE is_default;

-- Override класса инструмента ВНУТРИ портфеля (WEB-45) — единственное место,
-- где класс ещё нужен (Р-446). Крипте — своя планка. `instrument_class` —
-- ключ класса ('crypto', 'fx', 'stocks', …); отображение символ→класс живёт
-- выше (вопрос к штабу/CMS, см. отчёт), здесь только планка по классу.
CREATE TABLE IF NOT EXISTS leverage_portfolio_class_overrides (
  portfolio_key    TEXT NOT NULL REFERENCES leverage_portfolios(key) ON DELETE CASCADE,
  instrument_class TEXT NOT NULL,
  leverage         INT  NOT NULL CHECK (leverage >= 1),
  PRIMARY KEY (portfolio_key, instrument_class)
);

-- Плечо КЛИЕНТА: его портфель (атрибут клиента, WEB-44) и опциональный
-- override по заявке (WEB-46). Override, когда задан, имеет приоритет над
-- портфелем и классом; снимается возвратом к портфелю (override_* → NULL).
-- Поля заявки (кто/когда/основание/№ заявки) дублируют журнал НЕ ради истины
-- (истина — в журнале), а чтобы карточка показывала действующий override без
-- прохода по ленте. `last_journal_seq` — связь с установившей записью.
CREATE TABLE IF NOT EXISTS client_leverage (
  user_id           UUID PRIMARY KEY REFERENCES users(id),
  portfolio_key     TEXT NOT NULL REFERENCES leverage_portfolios(key),
  override_leverage INT  CHECK (override_leverage IS NULL OR override_leverage >= 1),
  override_reason   TEXT,
  override_ticket   TEXT,
  override_by       UUID REFERENCES operators(id),
  override_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq  BIGINT REFERENCES admin_action_journal(seq),
  -- Поля override неразделимы: либо все заданы, либо все NULL. Полуживой
  -- override (плечо есть, заявки нет) — след без решения, Р-049 это запрещает.
  CONSTRAINT client_leverage_override_all_or_none CHECK (
    (override_leverage IS NULL AND override_reason IS NULL AND override_ticket IS NULL
       AND override_by IS NULL AND override_at IS NULL)
    OR
    (override_leverage IS NOT NULL AND override_reason IS NOT NULL AND override_ticket IS NOT NULL
       AND override_by IS NOT NULL AND override_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS client_leverage_portfolio_idx ON client_leverage (portfolio_key);

-- Три стартовых портфеля (Р-446). Числа конфигурируемы — это СТАРТ, не бетон.
-- ON CONFLICT DO NOTHING: повторный накат не затирает уже настроенные админкой
-- значения (миграция идемпотентна, но не откатывает ручные правки плеча).
INSERT INTO leverage_portfolios (key, title, base_leverage, is_default, sort_order) VALUES
  ('standard',  'Standard',  20,  true,  10),
  ('pro',       'Pro',       50,  false, 20),
  ('enc_prime', 'ENC Prime', 100, false, 30)
ON CONFLICT (key) DO NOTHING;

-- Крипто-override Standard = 1:10 (Р-446: боевая планка, не витринная; заодно
-- делает показ настоящей конфигурацией). Остальные портфели крипто-планку
-- получают админкой по мере надобности.
INSERT INTO leverage_portfolio_class_overrides (portfolio_key, instrument_class, leverage) VALUES
  ('standard', 'crypto', 10)
ON CONFLICT (portfolio_key, instrument_class) DO NOTHING;
