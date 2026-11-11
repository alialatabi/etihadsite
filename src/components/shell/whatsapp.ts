/** `https://wa.me/<digits>` for a stored WhatsApp number, or null when unset/invalid. */
export function whatsappHref(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

/** `https://wa.me/<digits>?text=<text>` (text optional), or null when the number is unset/invalid. */
export function whatsappLink(raw: string, text?: string): string | null {
  const base = whatsappHref(raw);
  return base && text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
