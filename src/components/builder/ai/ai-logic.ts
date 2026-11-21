/** Pure helpers of the AI designer UI (no React), unit-tested in Node. */
import { builder, common } from '@/content/ar';
import { AI_MAX_REFS } from '@/lib/ai/config';
import type { BriefError, GenerateError } from './api';

export type AiErrorCode = BriefError | GenerateError;

/** Reference images: PNG or JPEG only (ruling R2). */
export const REF_ACCEPT = '.png,.jpg,.jpeg,image/png,image/jpeg';

function isPngOrJpeg(f: File): boolean {
  if (f.type === 'image/png' || f.type === 'image/jpeg') return true;
  // Some pickers leave the type empty: fall back to the extension.
  return !f.type && /\.(png|jpe?g)$/i.test(f.name);
}

/** The reference list after a pick: PNG/JPEG within the upload limit, at most AI_MAX_REFS in all. */
export function addRefs(current: File[], picked: File[], maxBytes: number): File[] {
  const ok = picked.filter((f) => isPngOrJpeg(f) && f.size > 0 && f.size <= maxBytes);
  return [...current, ...ok].slice(0, AI_MAX_REFS);
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

/** Arabic copy for an error code ('rate_limited' comes from the brief route only). Unknown codes read as 'failed'. */
export function aiErrorMessage(code: AiErrorCode): string {
  if (code === 'rate_limited') return common.errors.rateLimited;
  const errors: Record<string, string> = builder.ai.errors;
  return errors[code] ?? builder.ai.errors.failed;
}

/** The lines that are sent and printed: trimmed, without empty ones. */
export function printableLines(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0);
}
