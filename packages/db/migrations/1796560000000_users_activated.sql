-- Up Migration
--
-- Регистрация только с подтверждённой почтой (решение владельца 26.11, защита от ботов
-- перед открытием). `activated_at` — момент, когда клиент впервые доказал владение
-- адресом (ссылка подтверждения или сброс пароля по ссылке из письма). Ставится один
-- раз и не снимается: смена email оператором обнуляет `email_verified_at`, но не
-- выключает уже работающему клиенту вход.
--
-- Без `activated_at` сессия не выдаётся, а через 7 дней такой пользователь удаляется
-- (support-mail, housekeeping), если у него нет денег, документов и обращений.
--
-- Все, кто уже есть в базе, считаются активированными: их регистрировали по прежним
-- правилам, и отключать им вход задним числом нельзя.
--
-- Down намеренно нет — выкат вперёд (WEB-31).

ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

UPDATE users
   SET activated_at = COALESCE(email_verified_at, last_login_at, created_at)
 WHERE activated_at IS NULL;

CREATE INDEX IF NOT EXISTS users_unactivated_created_idx ON users (created_at) WHERE activated_at IS NULL;
