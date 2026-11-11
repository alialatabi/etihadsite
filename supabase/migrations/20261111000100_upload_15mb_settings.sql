-- Raise the stored shop-settings upload limit from 10 MB to 15 MB (owner request, 2026-11-11). Step 2 of 2.
-- public.settings.data.maxUploadBytes is what the upload checks and the text shown to customers
-- read. Keep it in step with DEFAULT_SETTINGS.maxUploadBytes in src/config/defaults.ts.
-- 15 MB = 15 * 1024 * 1024 = 15728640 bytes. Idempotent: safe to run twice.
--
-- Apply this file only AFTER 20261111000000_upload_15mb_bucket.sql was applied AND the new code is
-- deployed (see the rollout order in that file). If no settings row exists the site uses the new
-- code default (15 MB) and this statement changes nothing.

-- Only raise it: a stored limit that is already 15 MB or more is left alone.
update public.settings
   set data = jsonb_set(data, '{maxUploadBytes}', '15728640'::jsonb), updated_at = now()
 where id = 1
   and coalesce((data->>'maxUploadBytes')::bigint, 0) < 15728640;
