BEGIN;
UPDATE support_settings
   SET settings = settings || jsonb_build_object(
         'hours', COALESCE(settings -> 'hours', '{}'::jsonb) || '{"alwaysOpen": true}'::jsonb
       ),
       updated_at = now()
 WHERE id = 1;
SELECT settings -> 'hours' -> 'alwaysOpen' AS always_open FROM support_settings WHERE id = 1;
COMMIT;
