import "server-only";
import { common, order } from "@/content/ar";
import { formatIqd } from "@/lib/pricing";
import { shapeLabel, sizeLabel } from "@/lib/order-text";
import { countLabel } from "@/lib/plural";
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

/** Multi-design orders only: count, each size («مفرغ» when transparent) and copies received of each design. */
function designLines(record: OrderRecord): string[] {
  const designs = record.designs;
  if (!designs || designs.length === 0) return [];
  return [
    `${L.designs}: ${countLabel(designs.length, common.plural.design)}`,
    ...designs.map(
      (d, i) =>
        `${i + 1}) ${escapeHtml(sizeLabel(d.widthUm, d.heightUm))}${d.cutOut ? ` — ${L.cutOut}` : ""}`,
    ),
    `${L.perDesign}: ${countLabel(record.price.sheets * (record.layout.perDesign ?? 0), common.plural.sticker)}`,
  ];
}

/**
 * HTML caption for Telegram sendDocument (<= 1024 chars). The owner chose these
 * lines (2026-11-15): sheets, material, shape, delivery address, phone, total.
 */
export function buildCaption(
  record: OrderRecord,
  settings: ShopSettings,
): string {
  void settings;
  const c = record.customer;
  const phoneDigits = c.phone.replace(/\D/g, "");
  const phoneLinks = `<a href="tel:+${phoneDigits}">+${phoneDigits}</a> | <a href="https://wa.me/${phoneDigits}">${L.whatsapp}</a>`;

  const caption = [
    `<b>${L.title} — ${escapeHtml(record.displayNo)}</b>`,
    `${L.sheets}: ${record.price.sheets}`,
    `${L.material}: ${common.materials[record.price.material]}`,
    `${L.shape}: ${escapeHtml(shapeLabel(record.spec.shape, record.spec.corners))}`,
    `${L.address}: ${escapeHtml(
      [clip(c.governorate, 30), clip(c.district, 80), clip(c.landmark, 120)]
        .filter(Boolean)
        .join(" - "),
    )}`,
    `${L.phone}: ${phoneLinks}`,
    `${L.total}: ${money(record.price.totalIqd)}`,
    // Multi-design orders: the designs block goes LAST so a too-long caption loses it before the
    // phone and the total (safeTruncate cuts whole lines from the end).
    ...designLines(record),
  ].join("\n");
  return caption.length <= MAX_CAPTION
    ? caption
    : safeTruncate(caption, MAX_CAPTION);
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
