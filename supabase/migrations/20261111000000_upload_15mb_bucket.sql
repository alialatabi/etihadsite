-- Raise the bucket limit for design uploads from 10 MB to 15 MB (owner request, 2026-11-11). Step 1 of 2.
-- This is the hard limit of the browser -> bucket direct upload. Keep it in step with
-- SUPABASE_MAX_UPLOAD_BYTES in src/lib/storage/supabase.ts.
-- 15 MB = 15 * 1024 * 1024 = 15728640 bytes. Idempotent: safe to run twice.
--
-- ORDER OF ROLLOUT (do not change it):
--   1. apply THIS file first, before the deploy. It is harmless for the old code: the old code
--      still caps every upload at 10 MB itself (its SUPABASE_MAX_UPLOAD_BYTES mirror).
--   2. deploy the code.
--   3. apply 20261111000100_upload_15mb_settings.sql only after the deploy is live.
-- Applying the settings step before the deploy would let the old site accept a 10-15 MB file in
-- the design step and only fail it at submit; the old code cannot store it.

update storage.buckets set file_size_limit = 15728640 where id = 'etihad';
