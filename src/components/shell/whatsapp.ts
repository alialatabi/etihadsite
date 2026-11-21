/** `https://wa.me/<digits>` for a stored WhatsApp number, or null when unset/invalid. */
export function whatsappHref(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
