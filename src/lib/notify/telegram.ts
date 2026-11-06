import 'server-only';
import { SHOP_TIME_ZONE } from '@/config/defaults';
import { common, fill, order } from '@/content/ar';
import { formatIqd } from '@/lib/pricing';
import { shapeLabel, sizeLabel } from '@/lib/order-text';
import type { NotifyResult, OrderRecord, ShopSettings } from '@/lib/types';

const MAX_CAPTION = 1024;
const L = order.telegram;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function money(v: number | null): string {
  return v === null ? L.priceUnset : `${formatIqd(v)} ${common.units.iqd}`;
}

/** HTML caption for Telegram sendDocument (<= 1024 chars). */
export function buildCaption(record: OrderRecord, settings: ShopSettings): string {
  void settings;
  const c = record.customer;
  const time = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
    timeZone: SHOP_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(record.createdAt));
  const phoneDigits = c.phone.replace(/\D/g, '');
  const phoneLinks = `<a href="tel:+${phoneDigits}">+${phoneDigits}</a> | <a href="https://wa.me/${phoneDigits}">${L.whatsapp}</a>`;
  const dpi = record.design.effectiveDpi !== undefined ? `${Math.round(record.design.effectiveDpi)} DPI` : record.design.kind.toUpperCase();

  const head = [
    `<b>${L.title} — ${escapeHtml(record.displayNo)}</b>`,
    `${L.shape}: ${escapeHtml(shapeLabel(record.spec.shape, record.spec.corners))}`,
    `${L.size}: ${escapeHtml(sizeLabel(record.spec.widthUm, record.spec.heightUm))}`,
    `${L.perSheet}: ${record.layout.countPerSheet}`,
    `${L.sheets}: ${record.offer.sheets}`,
    `${L.totalStickers}: ${record.price.totalStickers}`,
    `${L.price}: ${money(record.price.offerPriceIqd)}`,
    `${L.delivery}: ${money(record.price.deliveryFeeIqd)}`,
    `${L.total}: ${money(record.price.totalIqd)}`,
    `${L.customer}: ${c.name ? escapeHtml(c.name) : '—'}`,
    `${L.phone}: ${phoneLinks}`,
    `${L.address}: ${escapeHtml([c.governorate, c.district, c.landmark].filter(Boolean).join(' - '))}`,
  ];
  const tail = [`${L.dpi}: ${escapeHtml(dpi)}`, `${L.time}: ${escapeHtml(time)}`];

  const build = (notes: string | null) =>
    [...head, ...(notes ? [`${L.notes}: ${escapeHtml(notes)}`] : []), ...tail].join('\n');

  let notes = c.notes?.trim() || null;
  let caption = build(notes);
  while (notes && caption.length > MAX_CAPTION) {
    const over = caption.length - MAX_CAPTION;
    notes = notes.length > over + 2 ? `${notes.slice(0, notes.length - over - 2)}…` : null;
    caption = build(notes);
  }
  return caption.length > MAX_CAPTION ? caption.slice(0, MAX_CAPTION - 1) : caption;
}

export async function sendTelegram(
  record: OrderRecord,
  pdf: Uint8Array,
  pdfFileName: string,
  settings: ShopSettings,
  cfg: { token?: string; chatId?: string },
): Promise<NotifyResult> {
  try {
    const chatId = cfg.chatId || settings.telegramChatId;
    if (!chatId) return { telegram: 'skipped' };
    if (!cfg.token) return { telegram: 'failed', error: 'TELEGRAM_BOT_TOKEN is not set' };

    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', buildCaption(record, settings));
    form.set('parse_mode', 'HTML');
    form.set('document', new Blob([pdf as BlobPart], { type: 'application/pdf' }), pdfFileName);

    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    let body: { ok?: boolean; description?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* non-JSON response */
    }
    if (res.ok && body.ok !== false) return { telegram: 'sent' };
    return { telegram: 'failed', error: fill('HTTP {status}: {desc}', { status: res.status, desc: body.description ?? 'unknown' }) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { telegram: 'failed', error: msg.replace(cfg.token ?? '\u0000', '***') };
  }
}
