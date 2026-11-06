/**
 * Iraqi mobile number normalisation — OWNED BY AGENT A. Pure.
 *
 * Accept any of: "07701234567", "7701234567", "+9647701234567", "009647701234567",
 * "964 770 123 4567", "٠٧٧٠١٢٣٤٥٦٧", with spaces/dashes/parentheses.
 * Steps: normaliseDigits → strip non-digits → strip leading 00964 / 964 / 0 →
 * require exactly 10 digits starting with 7 → return "964" + digits (13 digits, no plus).
 * Anything else → null.
 */
export function normalisePhone(input: string): string | null {
  void input;
  throw new Error('NOT_IMPLEMENTED: normalisePhone (Agent A)');
}

/** "9647701234567" → "0770 123 4567" for display. */
export function formatPhoneLocal(e164Digits: string): string {
  void e164Digits;
  throw new Error('NOT_IMPLEMENTED: formatPhoneLocal (Agent A)');
}

/** "9647701234567" → "https://wa.me/9647701234567" (+ ?text= when provided). */
export function whatsappUrl(e164Digits: string, text?: string): string {
  const base = `https://wa.me/${e164Digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
