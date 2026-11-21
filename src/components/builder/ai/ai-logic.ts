/** Pure helpers of the AI designer UI (no React), unit-tested in Node. */
import { builder } from '@/content/ar';
import { AI_MAX_REFS } from '@/lib/ai/config';
import { cleanLine, stripUnprintable } from '@/lib/ai/sanitize';
import { textCapacity } from '@/lib/ai/text-capacity';
import type { Corners, LayoutSettings, QualitySettings, Shape } from '@/lib/types';
import { aiAcceptedSize, dpiFor, dpiStatus, type DpiStatus } from '../logic';
import { maxWidthAtAspect } from '../safe';
import type { BriefError, ClientError, GenerateError } from './api';

export type AiPhase = 'idle' | 'reviewing' | 'generating' | 'result' | 'error';

export type AiErrorCode = BriefError | GenerateError | ClientError;

/** Reference images: PNG or JPEG only (ruling R2). */
export const REF_ACCEPT = '.png,.jpg,.jpeg,image/png,image/jpeg';

function isPngOrJpeg(f: File): boolean {
  if (f.type === 'image/png' || f.type === 'image/jpeg') return true;
  // Some pickers leave the type empty: fall back to the extension.
  return !f.type && /\.(png|jpe?g)$/i.test(f.name);
}

/**
 * The reference list after a pick: PNG/JPEG within the upload limit, at most AI_MAX_REFS in all.
 * `rejected` counts the picked files left out (wrong type, too big, over the limit): the page says so.
 */
export function addRefs(current: File[], picked: File[], maxBytes: number): { files: File[]; rejected: number } {
  const ok = picked.filter((f) => isPngOrJpeg(f) && f.size > 0 && f.size <= maxBytes);
  const files = [...current, ...ok].slice(0, AI_MAX_REFS);
  return { files, rejected: picked.length - (files.length - current.length) };
}

/** The generated PNG (base64 from the route) as the File the builder decodes, previews and keeps in the draft. */
export function pngFileFromBase64(b64: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], 'ai-design.png', { type: 'image/png' });
}

/** Errors that mean the site cannot design for this customer now: the idea field gives way to a notice. */
export function isAiOffError(code: AiErrorCode): boolean {
  return code === 'unavailable' || code === 'site_limit' || code === 'blocked';
}

/**
 * Arabic copy for an error code. 'rate_limited' comes from the brief route (also its answer to a blocked IP),
 * so it reads as "not available now, upload your own design". Unknown codes read as 'failed'.
 */
export function aiErrorMessage(code: AiErrorCode): string {
  if (code === 'rate_limited') return builder.ai.unavailable;
  const errors: Record<string, string> = builder.ai.errors;
  return errors[code] ?? builder.ai.errors.failed;
}

/** A try is running: the page-1 generate button and the step Back button are off (the try is counted and paid). */
export function aiBusy(phase: AiPhase, briefing: boolean): boolean {
  return briefing || phase === 'generating';
}

/**
 * Page 1 offers «شوف التصميم» while a try runs or a result waits to be accepted (also after «عدّل الفكرة»
 * or a failed retry: the paid result is kept until a new one arrives). The design step hides the generic
 * Next on the same condition.
 */
export function showViewResult(phase: AiPhase, hasResult: boolean): boolean {
  return hasResult || phase === 'generating';
}

/** The design step shows the kept result whenever there is one, except while a new try runs. */
export function resultShown(phase: AiPhase, hasResult: boolean): boolean {
  return hasResult && phase !== 'generating';
}

/** Errors after which the same request cannot succeed (or may not run again today): no retry button. */
const NO_RETRY: readonly AiErrorCode[] = ['ip_limit', 'text_too_long', 'invalid_request'];

/** «جرّب مرة لخ» is offered: the feature is on, tries are left, and the error on screen (if any) allows it. */
export function canRetryAi(s: { off: boolean; remainingToday: number | null; phase: AiPhase; error: AiErrorCode | undefined }): boolean {
  if (s.off || s.remainingToday === 0) return false;
  return !(s.phase === 'error' && s.error !== undefined && NO_RETRY.includes(s.error));
}

/**
 * The shape and size an AI result will have once accepted: `aiAcceptedSize` at the decoded ratio (the one the
 * arrangement step starts from, spec 5.7). For a custom shape the pixels are the full canvas (the trim happens at
 * accept), so the ratio can only differ slightly. null when the pixel size is unknown.
 */
export function resultAcceptedSpec(r: {
  pxWidth: number;
  pxHeight: number;
  madeFor: { shape: Shape; widthUm: number; heightUm: number };
}): { shape: Shape; widthUm: number; heightUm: number } | null {
  if (!(r.pxWidth > 0) || !(r.pxHeight > 0)) return null;
  const { shape } = r.madeFor;
  const size = aiAcceptedSize(shape, r.madeFor, r.pxWidth / r.pxHeight);
  return { shape, widthUm: size.widthUm, heightUm: shape === 'circle' ? size.widthUm : size.heightUm };
}

/**
 * The DPI state the arrangement step would show for a result accepted at the size it was made for (spec 5.7):
 * the size is the one `aiAcceptedSize` gives at accept. For a custom shape the pixels are the full canvas (the
 * trim happens at accept), so this can only read better than the arrangement step, never worse.
 */
export function resultDpiStatus(
  r: { pxWidth: number; pxHeight: number; madeFor: { shape: Shape; widthUm: number; heightUm: number } },
  quality: QualitySettings,
): DpiStatus {
  const spec = resultAcceptedSpec(r);
  if (!spec) return 'ok';
  return dpiStatus(dpiFor({ kind: 'png', pxWidth: r.pxWidth, pxHeight: r.pxHeight }, spec), quality);
}

/** A line as typed in the review box: the characters that are never printed go at once; spaces stay as typed. */
export function typedLine(line: string): string {
  return stripUnprintable(line);
}

/** The lines that are sent and printed: cleaned exactly as the server cleans them, without empty ones. */
export function printableLines(lines: string[]): string[] {
  return lines.map(cleanLine).filter((l) => l.length > 0);
}

/**
 * The text does not fit the size at 12 pt: a warning only (never a block).
 * 'enlarge' carries a size (width, µm) that fits and that the size step accepts; 'reduce' means no such size, so
 * the advice is to write less.
 */
export type TextWarning = { kind: 'enlarge'; sizeUm: number } | { kind: 'reduce' } | null;

/**
 * The widest size the size step accepts for a sticker with the ratio of `size` (shares `maxWidthAtAspect` with `maxWidthUm` in useBuilder,
 * which is taken at the current design's ratio): for the checks where the size is not the design's own, such as the
 * review box (a rectangle is typed freely there) and a result that is not accepted yet.
 */
export function maxWidthAtSize(
  shape: Shape | null,
  corners: Corners,
  size: { widthUm: number; heightUm: number } | null,
  layout: LayoutSettings,
): number | null {
  if (!shape || !size || !(size.widthUm > 0) || !(size.heightUm > 0)) return null;
  return maxWidthAtAspect(shape, corners, size.widthUm / size.heightUm, layout);
}

/**
 * Warning for `lines` (as typed or as printed: cleaned here exactly as for the print) on `size`.
 * `maxWidthUm` is the widest size the size step accepts (null: unknown): a larger size is never recommended.
 */
export function textWarning(
  lines: string[],
  shape: Shape | null,
  size: { widthUm: number; heightUm: number } | null,
  maxWidthUm: number | null,
): TextWarning {
  if (!shape || !size) return null;
  const capacity = textCapacity(printableLines(lines), shape, size.widthUm, size.heightUm);
  if (capacity.ok) return null;
  const min = capacity.minSizeUm;
  if (min !== null && (maxWidthUm === null || min <= maxWidthUm)) return { kind: 'enlarge', sizeUm: min };
  return { kind: 'reduce' };
}
