/**
 * Millimetre input parsing for the receipts spacing fields. Pure, next to cm.ts.
 *
 * Accepts what `parseCm` accepts (Arabic-Indic and Persian digits, '.', ',' and '٫' as the decimal
 * mark, surrounding spaces) with a trailing "ملم", "مم" or "mm" instead of "سم" / "cm". Unlike
 * `parseCm`, ZERO IS ALLOWED (no white at all is a normal spacing). Returns INTEGER µm (mm x 1000,
 * rounded), or null for empty text, a negative number, an exponent or anything that is not a number.
 * Examples: "0" → 0; "7,5" → 7500; "٧٫٢٢" → 7220; "15 ملم" → 15000; "" / "-1" / "abc" / "1e2" → null.
 */
import { mmToUm, umToMm } from '@/lib/units';
import { normaliseDigits } from './digits';

export function parseMm(input: string): number | null {
  if (typeof input !== 'string') return null;
  const t = normaliseDigits(input)
    .trim()
    .replace(/\s*(ملم|مم|mm)$/i, '')
    .trim()
    .replace(/[,٫]/g, '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const um = mmToUm(Number(t));
  return Number.isSafeInteger(um) && um >= 0 ? um : null;
}

/** µm → display string in mm with up to 2 decimals, Western digits, no unit. 7220 → "7.22"; 15000 → "15"; 0 → "0". */
export function formatMm(um: number): string {
  if (!Number.isFinite(um)) return '';
  return String(Number(umToMm(um).toFixed(2)));
}
