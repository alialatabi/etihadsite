/**
 * Centimetre input parsing. Pure.
 *
 * Customers type on Arabic keyboards. Accept:
 *  - Arabic-Indic digits ٠-٩ and Persian digits ۰-۹ → 0-9
 *  - decimal separators '.', ',', '٫'
 *  - surrounding whitespace, a trailing "سم" or "cm"
 * Return INTEGER µm (cm × 10 000, rounded), or null when not a positive finite number.
 * Examples: "3" → 30000; "3,5" → 35000; "٣٫٢٥" → 32500; " 4 " → 40000; "abc" → null; "0" → null.
 */
import { cmToUm, umToCm } from '@/lib/units';
import { normaliseDigits } from './digits';

// Kept importable from here for existing callers and tests.
export { normaliseDigits } from './digits';

export function parseCm(input: string): number | null {
  if (typeof input !== 'string') return null;
  const t = normaliseDigits(input)
    .trim()
    .replace(/\s*(سم|cm)$/i, '')
    .trim()
    .replace(/[,٫]/g, '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const um = cmToUm(Number(t));
  return Number.isSafeInteger(um) && um > 0 ? um : null;
}

/** µm → display string in cm with up to 2 decimals, Western digits, no unit. 42420 → "4.24"; 30000 → "3". */
export function formatCm(um: number): string {
  if (!Number.isFinite(um)) return '';
  return String(Number(umToCm(um).toFixed(2)));
}
