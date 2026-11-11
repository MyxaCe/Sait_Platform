-- Up Migration
--
-- Вывод без верификации в пределах доли (ветка demo-withdraw-limits, 11.11,
-- решение владельца): при гейте «вывод только после KYC» неверифицированный
-- клиент может вывести СУММАРНО за всё время не больше X % «баланса до
-- выводов» (формула — `packages/money/src/kyc-allowance.ts`). Доля — в базисных
-- пунктах (1 б.п. = 0,01 %), 500 = 5 %; 0 = без верификации вывод запрещён
-- полностью (прежнее поведение).
--
-- Платформа — значение по умолчанию; у клиента — переопределение (NULL =
-- наследовать). Изменения журналируются той же транзакцией, что и запись.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

ALTER TABLE platform_money_settings
  ADD COLUMN IF NOT EXISTS unverified_withdraw_bps INTEGER NOT NULL DEFAULT 500
    CHECK (unverified_withdraw_bps BETWEEN 0 AND 10000);

ALTER TABLE client_money_flags
  ADD COLUMN IF NOT EXISTS unverified_withdraw_bps INTEGER
    CHECK (unverified_withdraw_bps IS NULL OR unverified_withdraw_bps BETWEEN 0 AND 10000);
