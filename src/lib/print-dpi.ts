/**
 * Fixed print resolution of the WEBSITE's layouts (التسفيط; owner decision, 2026-11-15). It is a
 * MAXIMUM: a raster sharper than this at the ordered size is resampled DOWN to exactly this; a
 * raster below it is kept as it is (never upscaled). Vector PDFs stay vector. Replaces the old,
 * never-editable `settings.quality.targetDpi` (now ignored).
 *
 * It no longer applies to the staff page (owner, 2026-11-26): staff PDFs carry the uploaded file
 * at its own resolution and colours (`prepareOriginalArtwork`, src/lib/design/original.client.ts);
 * there it is only the floor of the "never downscale" fallback dpi and the PDF path.
 *
 * Lives next to `units.ts`, not in it: tests/unit/golden pins the export list of `units.ts`.
 * Client-safe (no imports, no `server-only`).
 */
export const PRINT_DPI = 1200;
