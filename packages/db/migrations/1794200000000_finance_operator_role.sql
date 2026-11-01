-- Up Migration
--
-- Роль `finance_operator` (Р-455 R-3): отдельная роль ради separation of duties
-- в денежном контуре. Инициация денежных команд и второй аппрув — admin и
-- finance_operator; управление операторами / риск-настройки / break-glass —
-- только admin. Заводим роль ДО миграции денежных команд, чтобы
-- `money_commands.initiator_role` мог на неё ссылаться по значению.
--
-- Расширяем CHECK роли операторов. Снимаем старый именованный констрейнт (имя
-- присвоено Postgres по умолчанию: <table>_<column>_check) и ставим новый с
-- расширенным перечнем. Существующие строки (admin/operator) остаются валидны.
--
-- Down намеренно нет — выкат вперёд (как у соседних миграций зоны, WEB-31).

ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_role_check;
ALTER TABLE operators
  ADD CONSTRAINT operators_role_check
  CHECK (role IN ('admin', 'operator', 'finance_operator'));
