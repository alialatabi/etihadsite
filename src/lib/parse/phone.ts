/**
 * Iraqi mobile number normalisation. Pure.
 *
 * Accept any of: "07701234567", "7701234567", "+9647701234567", "009647701234567",
 * "964 770 123 4567", "٠٧٧٠١٢٣٤٥٦٧", with spaces/dashes/parentheses.
 * Steps: normaliseDigits → strip non-digits → strip leading 00964 / 964 / 0 →
 * require exactly 10 digits starting with 7 → return "964" + digits (13 digits, no plus).
 * Anything else → null.
 */
import { normaliseDigits } from '@/lib/parse/digits';

export function normalisePhone(input: string): string | null {
  if (typeof input !== 'string') return null;
  let d = normaliseDigits(input).replace(/\D/g, '');
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^7\d{9}$/.test(d) ? `964${d}` : null;
}

/** "9647701234567" → "0770 123 4567" for display. Returns the input unchanged when it is not 964 + 10 digits. */
export function formatPhoneLocal(e164Digits: string): string {
  const m = /^964(7\d{2})(\d{3})(\d{4})$/.exec(e164Digits);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164Digits;
}

/** "9647701234567" → "https://wa.me/9647701234567" (+ ?text= when provided). */
export function whatsappUrl(e164Digits: string, text?: string): string {
  const base = `https://wa.me/${e164Digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
