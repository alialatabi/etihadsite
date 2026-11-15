/**
 * Fixed print resolution of every layout (التسفيط), on the website and on the staff page
 * (owner decision, 2026-11-15). It is a MAXIMUM: a raster sharper than this at the ordered size is
 * resampled DOWN to exactly this; a raster below it is kept as it is (never upscaled). Vector PDFs
 * stay vector. Replaces the old, never-editable `settings.quality.targetDpi` (now ignored).
 *
 * Lives next to `units.ts`, not in it: tests/unit/golden pins the export list of `units.ts`.
 * Client-safe (no imports, no `server-only`).
 */
export const PRINT_DPI = 1200;
