-- Up Migration
--
-- Экскурсия по платформе (docs/site/интерактивное-обучение.md): какие части
-- клиент прошёл или пропустил. {"cabinet":{"v":1,"s":"done"},"terminal":{...}}.
-- "autostart": true ставит регистрация — только новичку часть показывается
-- сама один раз. У уже зарегистрированных '{}' — экскурсия только по кнопке «?».
-- Down намеренно нет — выкат вперёд (WEB-31).

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding JSONB NOT NULL DEFAULT '{}'::jsonb;
