/**
 * Clean-up of a printed line. Pure and browser-safe (no `server-only`): the review box and the
 * server use the same functions, so the lines the customer confirms are exactly the lines that are
 * printed and stored.
 */
import { AI_LINE_MAX_CHARS } from './config';

/** Control characters and line breaks become spaces; « » " ' ` < > go. Spaces are left as typed. */
export function stripUnprintable(line: string): string {
  return line.replace(/[\p{Cc}\u{2028}\u{2029}]/gu, ' ').replace(/[«»"'`<>]/g, '');
}

/** Removes « » " ' ` < >, control characters and newlines, collapses spaces, trims, cuts to the line limit. */
export function sanitizeLine(line: string): string {
  const cleaned = stripUnprintable(line).replace(/\s+/g, ' ').trim();
  return Array.from(cleaned).slice(0, AI_LINE_MAX_CHARS).join('').trim();
}

/** Cuts to at most `max` UTF-16 units without leaving half a surrogate pair. */
export function capUnits(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}

/** A printed line as both AI routes and the review box see it: sanitised, and within the zod limit of generate. */
export function cleanLine(line: string): string {
  return capUnits(sanitizeLine(line), AI_LINE_MAX_CHARS).trim();
}
