/** Pure helpers of the sheet download button (no I/O, unit-tested in Node). */

/** Name used when a response carries no usable Content-Disposition. */
export const FALLBACK_SHEET_NAME = 'softy-sheet.pdf';

/**
 * The file name of a `Content-Disposition: attachment; filename="…"` header, reduced to a safe plain name
 * (no path parts, no control characters); FALLBACK_SHEET_NAME when the header is missing or has none.
 */
export function filenameFromDisposition(header: string | null): string {
  const m = header ? /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header) : null;
  const raw = m?.[1]?.trim() ?? '';
  const safe = raw.replace(/[\\/\u0000-\u001f]/g, '').replace(/^\.+/, '');
  return safe || FALLBACK_SHEET_NAME;
}

/** The Arabic `message` of the sheet route's JSON error body, or null when the body has none. */
export function errorMessageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() !== '' ? message : null;
}
