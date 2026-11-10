-- Поддержка «круглосуточно» (24/7) на стенде — ЗАПАСНОЙ путь.
--
-- Основной путь (с валидацией и записью в журнал «до/после» от admin):
--   DATABASE_URL=… pnpm --filter @broker/admin support:always-open -- --operator <login админа>
-- либо в админке: Поддержка → Настройки → «Круглосуточно» + основание.
--
-- Этот SQL меняет ТОЛЬКО hours.alwaysOpen и НЕ пишет в журнал действий —
-- применять, если скрипт недоступен, и отметить выкат в журнале смены.
-- Идемпотентен. Работает и на пустых настройках ('{}' — всё по умолчанию):
-- jsonb_set не создаёт отсутствующий родительский ключ, поэтому склейка.
--
-- Эффект: SLA первого ответа считается без пауз (ночь/выходные/праздники),
-- виджет кабинета не показывает «вне рабочих часов», автоответ «вне часов» в
-- чате не отправляется. Уже открытые обращения сохраняют прежний срок SLA.

BEGIN;
UPDATE support_settings
   SET settings = settings || jsonb_build_object(
         'hours', COALESCE(settings -> 'hours', '{}'::jsonb) || '{"alwaysOpen": true}'::jsonb
       ),
       updated_at = now()
 WHERE id = 1;
SELECT settings -> 'hours' -> 'alwaysOpen' AS always_open FROM support_settings WHERE id = 1;
COMMIT;

-- Откат: то же с '{"alwaysOpen": false}'.
