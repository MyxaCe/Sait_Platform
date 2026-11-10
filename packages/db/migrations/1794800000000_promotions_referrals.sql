-- Up Migration
--
-- Акции, рефералы, конкурсы, IB-партнёры и тарифы портфелей (дизайн
-- «ДЕМО-акции-и-рефералы», решения владельца 10.11).
--
-- Сквозной принцип владельца: НИЧЕГО не хардкодим. Числа акций (проценты,
-- лимиты, бюджеты, сроки), тексты условий для клиента, вкл/выкл, ставки
-- партнёров и тарифы портфелей живут ЗДЕСЬ и меняются админкой (форма с
-- основанием → журнал той же транзакцией, Р-049). Значения в INSERT ниже —
-- стартовая конфигурация, а не бетон.
--
-- Деньги здесь НЕ хранятся (Р-396). Вознаграждение — это ЗАЯВКА на
-- начисление (`promo_rewards`): оператор одобряет с основанием → терминал
-- `deposit` на реальный счёт с `external_ref` (идемпотентно). Бюджет акции —
-- величина распоряжения, не баланс: `spent_minor` ≤ `budget_minor` держит и
-- код (в транзакции одобрения), и CHECK базы.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

-- Системный автор журнала для переходов, которые делает движок акций
-- (постановка в очередь по выполненным условиям). Войти им нельзя.
INSERT INTO operators (id, login, display_name, role, disabled_at) VALUES
  ('00000000-0000-4000-8000-00000000c0b3', 'system:promo-engine', 'Система · движок акций', 'operator', now())
ON CONFLICT (login) DO NOTHING;

-- ── Клиент: страна и IP регистрации (комплаенс, антифрод) ──────────────────
-- `country` — из формы регистрации (ISO-3166 alpha-2), `registration_ip` — IP
-- запроса регистрации, `registration_ip_country` — страна по гео-заголовку
-- прокси (если он есть). Расхождение двух стран — сигнал, а не отказ.
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip_country TEXT;
CREATE INDEX IF NOT EXISTS users_registration_ip_idx ON users (registration_ip);

-- ── Настройки акций платформы (синглтон, как platform_money_settings) ──────
-- `promotions_enabled = false` — «акции выключены» (профиль юрисдикции ЕС/UK/AU):
-- новые участия и постановка в очередь закрыты, кабинет акций не показывает.
-- `blocked_countries` — страны клиентов, которым акции не показываются вовсе.
-- `attribution_window_days` — срок жизни first-click атрибуции (cookie и
-- проверка при регистрации).
CREATE TABLE IF NOT EXISTS platform_promo_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  promotions_enabled BOOLEAN NOT NULL DEFAULT true,
  attribution_window_days INT NOT NULL DEFAULT 30
    CHECK (attribution_window_days BETWEEN 1 AND 365),
  blocked_countries TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq)
);
INSERT INTO platform_promo_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Тарифы портфеля (доход платформы, решение владельца №6) ────────────────
-- Наценка на спред и комиссия — ставки в базисных пунктах (1 б.п. = 0,01 %;
-- предел 0..500 — граница маршрута терминала `fees`),
-- задаются на портфель админкой и уезжают в терминал маршрутом `fees` (как
-- плечо). `instruments` / `description` / `is_public` — условия типа счёта для
-- публичной страницы /accounts: витрина берёт их отсюда, не из кода.
ALTER TABLE leverage_portfolios ADD COLUMN IF NOT EXISTS markup_bps INT NOT NULL DEFAULT 0
  CHECK (markup_bps BETWEEN 0 AND 500);
ALTER TABLE leverage_portfolios ADD COLUMN IF NOT EXISTS commission_bps INT NOT NULL DEFAULT 0
  CHECK (commission_bps BETWEEN 0 AND 500);
ALTER TABLE leverage_portfolios ADD COLUMN IF NOT EXISTS instruments TEXT;
ALTER TABLE leverage_portfolios ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE leverage_portfolios ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

-- ── Акции ──────────────────────────────────────────────────────────────────
-- Одна строка — правила одной акции. `rules` — типизированный jsonb, схема
-- валидации (Zod) — `@broker/promo` (`rules.ts`), одна на запись и чтение.
-- `texts` — тексты для клиента по локалям {ru:{title,summary,terms}, en:…}.
-- `countries_allow` / `countries_deny` — юрисдикционный фильтр акции (пустой
-- allow = все страны). `spent_minor` — сумма ОДОБРЕННЫХ начислений (резерв
-- бюджета на одобрении; освобождается только отклонением после отказа
-- терминала).
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  type TEXT NOT NULL CHECK (type IN ('deposit_bonus', 'cashback', 'contest', 'referral')),
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  cms_promo_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  rules JSONB NOT NULL,
  texts JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  budget_minor BIGINT NOT NULL CHECK (budget_minor >= 0),
  spent_minor BIGINT NOT NULL DEFAULT 0,
  countries_allow TEXT[] NOT NULL DEFAULT '{}',
  countries_deny TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES operators(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT promotions_slug_uniq UNIQUE (slug),
  CONSTRAINT promotions_budget_not_exceeded CHECK (spent_minor >= 0 AND spent_minor <= budget_minor),
  CONSTRAINT promotions_period CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS promotions_status_idx ON promotions (status, type);

-- Участие клиента в акции (deposit_bonus / cashback / referral-друг).
-- enrolled → qualified → rewarded; ветки expired (окно истекло / вывод до
-- выплаты), rejected (оператор), not_eligible (условие входа не выполнено,
-- напр. первый депозит до старта акции). `progress` — снимок последней оценки
-- (условия, факты) для показа и аудита.
CREATE TABLE IF NOT EXISTS promo_participations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'enrolled'
    CHECK (status IN ('enrolled', 'qualified', 'rewarded', 'expired', 'rejected', 'not_eligible')),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promo_participations_once UNIQUE (promotion_id, user_id)
);
CREATE INDEX IF NOT EXISTS promo_participations_user_idx ON promo_participations (user_id);

-- ── IB-партнёры ────────────────────────────────────────────────────────────
-- Партнёр — клиент платформы (выплаты — на его реальный счёт), привлекает по
-- своему реф-коду. Модель: CPA (фикс за квалифицированного клиента, условия
-- квалификации — `cpa_rules`) или revshare (доля дохода платформы — наценка +
-- комиссия — с привлечённых, в б.п.).
CREATE TABLE IF NOT EXISTS ib_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) > 0),
  model TEXT NOT NULL CHECK (model IN ('cpa', 'revshare')),
  cpa_amount_minor BIGINT CHECK (cpa_amount_minor IS NULL OR cpa_amount_minor > 0),
  cpa_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  revshare_bps INT CHECK (revshare_bps IS NULL OR revshare_bps BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_by UUID REFERENCES operators(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT ib_partners_user_uniq UNIQUE (user_id),
  CONSTRAINT ib_partners_model_params CHECK (
    (model = 'cpa' AND cpa_amount_minor IS NOT NULL)
    OR (model = 'revshare' AND revshare_bps IS NOT NULL)
  )
);

-- ── Рефералы ───────────────────────────────────────────────────────────────
-- Реф-код клиента: создаётся лениво (первое открытие «Пригласи друга»).
CREATE TABLE IF NOT EXISTS referral_codes (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9]{6,16}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referral_codes_code_uniq UNIQUE (code)
);

-- Атрибуция: кто привёл клиента. Один реферер на клиента (PK по рефералу),
-- first-click, без перезаписи кодом; переназначение — только admin с
-- основанием (журнал `referral.attribution.*`). Самореферал отсекается:
-- CHECK + `status = 'rejected'` с причиной (общий IP / email), строка
-- остаётся для аудита. `ib_partner_id` — если реферер — IB-партнёр.
CREATE TABLE IF NOT EXISTS referral_attributions (
  referee_user_id UUID PRIMARY KEY REFERENCES users(id),
  referrer_user_id UUID REFERENCES users(id),
  ib_partner_id UUID REFERENCES ib_partners(id),
  code TEXT,
  promo_slug TEXT,
  source TEXT NOT NULL CHECK (source IN ('cookie', 'param', 'manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rejected', 'revoked')),
  reject_reason TEXT,
  first_click_at TIMESTAMPTZ,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT referral_attributions_not_self CHECK (
    referrer_user_id IS NULL OR referrer_user_id <> referee_user_id
  ),
  CONSTRAINT referral_attributions_rejected_reason CHECK (
    status <> 'rejected' OR reject_reason IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS referral_attributions_referrer_idx ON referral_attributions (referrer_user_id);
CREATE INDEX IF NOT EXISTS referral_attributions_ib_idx ON referral_attributions (ib_partner_id);

-- ── Конкурс на демо-счетах ─────────────────────────────────────────────────
-- Конкурс — акция типа `contest` (период = starts_at/ends_at акции; стартовая
-- сумма, мин. число сделок, призы по местам — в `rules`). Участие сбрасывает
-- демо-счёт терминалом (`POST /account/demo-reset`): строка `pending_reset`
-- пишется ДО вызова, базу (`baseline_minor`) ставит консюмер по событию
-- `terminal.balance.changed` reason=reset — фактическую сумму сброса.
-- Доходность = Σ realized P&L демо-сделок в окне / baseline (незакрытые
-- позиции не считаются; повторный сброс доходность не обнуляет).
CREATE TABLE IF NOT EXISTS contest_entries (
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending_reset', 'active', 'disqualified', 'withdrawn')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  baseline_minor BIGINT CHECK (baseline_minor IS NULL OR baseline_minor > 0),
  baseline_at TIMESTAMPTZ,
  resets_count INT NOT NULL DEFAULT 0,
  disqualified_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (promotion_id, user_id),
  CONSTRAINT contest_entries_active_has_baseline CHECK (
    status <> 'active' OR (baseline_minor IS NOT NULL AND baseline_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS contest_entries_user_idx ON contest_entries (user_id, status);

-- Снимки лидерборда: промежуточные (для истории) и ОДИН итоговый на конкурс —
-- по нему призы уходят в очередь начислений.
CREATE TABLE IF NOT EXISTS contest_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_final BOOLEAN NOT NULL DEFAULT false,
  standings JSONB NOT NULL,
  taken_by UUID REFERENCES operators(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS contest_snapshots_one_final
  ON contest_snapshots (promotion_id) WHERE is_final;

-- ── Начисления — очередь одобрения ─────────────────────────────────────────
-- pending ─► approved ─► credited
--    │          └─► needs_review (терминал отказал) ─► rejected (бюджет освобождён)
--    └─► rejected
-- `approved` — бюджет зарезервирован, вызов терминала мог не дойти (исход
-- неизвестен): повтор с тем же `external_ref` безопасен. Отклонить `approved`
-- нельзя — деньги могли уйти.
-- external_ref: promo:<promotion>:<user> · ref:<friend>:<referrer|referee> ·
-- cashback:<promotion>:<YYYY-MM>:<user> · contest:<promotion>:<place> ·
-- ib:cpa:<client> · ib:rev:<partner>:<YYYY-MM>.
-- `signals` — сигналы связанности на момент постановки (подсказка оператору).
CREATE TABLE IF NOT EXISTS promo_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('promo', 'referral', 'cashback', 'contest', 'ib')),
  promotion_id UUID REFERENCES promotions(id),
  ib_partner_id UUID REFERENCES ib_partners(id),
  participation_id UUID REFERENCES promo_participations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  -- Второй участник пары (друг для реферера, клиент IB) — для показа и сигналов.
  related_user_id UUID REFERENCES users(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  period TEXT,
  external_ref TEXT NOT NULL CHECK (length(external_ref) BETWEEN 1 AND 200),
  basis JSONB NOT NULL DEFAULT '{}'::jsonb,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'credited', 'needs_review', 'rejected')),
  decided_by UUID REFERENCES operators(id),
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  reject_reason TEXT,
  check_note TEXT,
  terminal_seq BIGINT,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_journal_seq BIGINT REFERENCES admin_action_journal(seq),
  CONSTRAINT promo_rewards_external_ref_uniq UNIQUE (external_ref),
  CONSTRAINT promo_rewards_owner CHECK (
    (kind = 'ib' AND ib_partner_id IS NOT NULL) OR (kind <> 'ib' AND promotion_id IS NOT NULL)
  ),
  CONSTRAINT promo_rewards_decided CHECK (
    status = 'pending' OR (decided_by IS NOT NULL AND decision_reason IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS promo_rewards_status_idx ON promo_rewards (status, created_at);
CREATE INDEX IF NOT EXISTS promo_rewards_user_idx ON promo_rewards (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS promo_rewards_promotion_idx ON promo_rewards (promotion_id);

-- ── Комиссия и наценка в проекции сделок (аддитивно, терпимо к отсутствию) ─
-- Терминал добавляет в `trade.executed` поля `commissionMinor`, `markupMinor`,
-- `marketPrice`. Старые события их не несут: NULL = «не знаем», не ноль.
ALTER TABLE real_trades ADD COLUMN IF NOT EXISTS commission_minor BIGINT;
ALTER TABLE real_trades ADD COLUMN IF NOT EXISTS markup_minor BIGINT;
ALTER TABLE real_trades ADD COLUMN IF NOT EXISTS market_price NUMERIC;
ALTER TABLE demo_trades ADD COLUMN IF NOT EXISTS commission_minor BIGINT;
ALTER TABLE demo_trades ADD COLUMN IF NOT EXISTS markup_minor BIGINT;
ALTER TABLE demo_trades ADD COLUMN IF NOT EXISTS market_price NUMERIC;
