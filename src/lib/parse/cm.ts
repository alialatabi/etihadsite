/**
 * Centimetre input parsing — OWNED BY AGENT A. Pure.
 *
 * Customers type on Arabic keyboards. Accept:
 *  - Arabic-Indic digits ٠-٩ and Persian digits ۰-۹ → 0-9
 *  - decimal separators '.', ',', '٫'
 *  - surrounding whitespace, a trailing "سم" or "cm"
 * Return INTEGER µm (cm × 10 000, rounded), or null when not a positive finite number.
 * Examples: "3" → 30000; "3,5" → 35000; "٣٫٢٥" → 32500; " 4 " → 40000; "abc" → null; "0" → null.
 */
export function parseCm(input: string): number | null {
  void input;
  throw new Error('NOT_IMPLEMENTED: parseCm (Agent A)');
}

/** µm → display string in cm with up to 2 decimals, Western digits, no unit. 42420 → "4.24"; 30000 → "3". */
export function formatCm(um: number): string {
  void um;
  throw new Error('NOT_IMPLEMENTED: formatCm (Agent A)');
}

/** Map ٠-٩ / ۰-۹ to 0-9, leave everything else untouched. */
export function normaliseDigits(input: string): string {
  void input;
  throw new Error('NOT_IMPLEMENTED: normaliseDigits (Agent A)');
}
