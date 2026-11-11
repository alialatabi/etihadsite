-- Set the stored shop-settings page margin to 3 mm (owner decision, 2026-11-12).
-- public.settings.data.layout.marginUm is the margin the layout engine uses on the live site (it was
-- 4000). Keep it in step with DEFAULT_SETTINGS.layout.marginUm in src/config/defaults.ts.
-- Idempotent: safe to run twice.
--
-- Apply this file only AFTER the code that draws the cutter dots and keeps stickers clear of them
-- is deployed. Before that, the live site keeps its old margin, which is also safe. If no settings
-- row exists the site uses the new code default (3 mm) and this statement changes nothing.

update public.settings
   set data = jsonb_set(data, '{layout,marginUm}', '3000'::jsonb), updated_at = now()
 where id = 1
   and coalesce((data->'layout'->>'marginUm')::int, -1) <> 3000;
