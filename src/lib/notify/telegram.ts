import "server-only";
import { common, fill, order } from "@/content/ar";
import { formatIqd } from "@/lib/pricing";
import { shapeLabel, sizeLabel } from "@/lib/order-text";
import { formatShopDateTime } from "@/lib/shop-time";
import type { NotifyResult, OrderRecord, ShopSettings } from "@/lib/types";

const MAX_CAPTION = 1024;
const L = order.telegram;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Cuts to at most `max` code points (before escaping), appending '…' when cut. */
function clip(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * Last resort: cut at a line boundary. Every line is self-contained, balanced HTML,
 * so this never lands inside an entity or a tag.
 */
function safeTruncate(caption: string, max: number): string {
  const cut = caption.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  return nl > 0 ? cut.slice(0, nl) : "";
}

function money(v: number | null): string {
  return v === null ? L.priceUnset : `${formatIqd(v)} ${common.units.iqd}`;
}

/** HTML caption for Telegram sendDocument (<= 1024 chars). */
export function buildCaption(
  record: OrderRecord,
  settings: ShopSettings,
): string {
  void settings;
  const c = record.customer;
  const time = formatShopDateTime(record.createdAt);
  const phoneDigits = c.phone.replace(/\D/g, "");
  const phoneLinks = `<a href="tel:+${phoneDigits}">+${phoneDigits}</a> | <a href="https://wa.me/${phoneDigits}">${L.whatsapp}</a>`;
  const dpi =
    record.design.effectiveDpi !== undefined
      ? `${Math.round(record.design.effectiveDpi)} DPI`
      : record.design.kind.toUpperCase();

  const discount =
    record.price.unitPriceIqd !== null && record.price.discountPercent > 0
      ? ` (${fill(L.discount, { percent: record.price.discountPercent })})`
      : "";

  const head = [
    `<b>${L.title} — ${escapeHtml(record.displayNo)}</b>`,
    `${L.shape}: ${escapeHtml(shapeLabel(record.spec.shape, record.spec.corners))}`,
    `${L.size}: ${escapeHtml(sizeLabel(record.spec.widthUm, record.spec.heightUm))}`,
    `${L.perSheet}: ${record.layout.countPerSheet}`,
    `${L.material}: ${common.materials[record.price.material]}`,
    ...(typeof record.price.requestedStickers === "number"
      ? [`${L.requestedStickers}: ${record.price.requestedStickers}`]
      : []),
    `${L.sheets}: ${record.price.sheets}`,
    `${L.totalStickers}: ${record.price.totalStickers}`,
    `${L.unitPrice}: ${money(record.price.unitPriceIqd)}${discount}`,
    `${L.subtotal}: ${money(record.price.subtotalIqd)}`,
    `${L.delivery}: ${money(record.price.deliveryFeeIqd)}`,
    `${L.total}: ${money(record.price.totalIqd)}`,
    `${L.customer}: ${c.name ? escapeHtml(clip(c.name, 60)) : "—"}`,
    `${L.phone}: ${phoneLinks}`,
    `${L.address}: ${escapeHtml(
      [clip(c.governorate, 30), clip(c.district, 80), clip(c.landmark, 120)]
        .filter(Boolean)
        .join(" - "),
    )}`,
  ];
  const tail = [
    `${L.dpi}: ${escapeHtml(dpi)}`,
    `${L.time}: ${escapeHtml(time)}`,
  ];

  const build = (notes: string | null) =>
    [
      ...head,
      ...(notes ? [`${L.notes}: ${escapeHtml(notes)}`] : []),
      ...tail,
    ].join("\n");

  const notes = c.notes?.trim() ? clip(c.notes.trim(), 300) : null;
  const caption = build(notes);
  if (caption.length <= MAX_CAPTION) return caption;
  const noNotes = build(null);
  return noNotes.length <= MAX_CAPTION
    ? noNotes
    : safeTruncate(noNotes, MAX_CAPTION);
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
    if (!chatId) return { telegram: "skipped" };
    if (!cfg.token)
      return { telegram: "failed", error: "TELEGRAM_BOT_TOKEN is not set" };

    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", buildCaption(record, settings));
    form.set("parse_mode", "HTML");
    form.set(
      "document",
      new Blob([pdf as BlobPart], { type: "application/pdf" }),
      pdfFileName,
    );

    const res = await fetch(
      `https://api.telegram.org/bot${cfg.token}/sendDocument`,
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(25_000),
      },
    );
    let body: { ok?: boolean; description?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* non-JSON response */
    }
    if (res.ok && body.ok !== false) return { telegram: "sent" };
    return {
      telegram: "failed",
      error: `HTTP ${res.status}: ${body.description ?? "unknown"}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      telegram: "failed",
      error: msg.replace(cfg.token ?? "\u0000", "***"),
    };
  }
}
