/** Digit normalisation shared by the cm, phone, sheet-count and customer-search parsers. Pure. */

/** Map ٠-٩ / ۰-۹ to 0-9, leave everything else untouched. */
export function normaliseDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const c = ch.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}
