import "server-only";
/**
 * Shop notification, sent by POST /api/orders after the order is saved.
 *
 * ORDER_TRANSPORT=console (default): log the Arabic summary, return { telegram: 'skipped' }.
 * On Vercel (VERCEL=1) the log line carries no caption (no phone or address), only file, size, displayNo.
 * ORDER_TRANSPORT=telegram: Bot API sendDocument (multipart) with the PDF as
 * `document`, `caption` = Arabic summary (<= 1024 chars, HTML), chat_id =
 * TELEGRAM_CHAT_ID || settings.telegramChatId (skipped when both are empty).
 * Never throws: returns { telegram: 'failed', error } on any failure.
 */
import { getOrderEnv } from "@/lib/env";
import type { NotifyResult, OrderRecord, ShopSettings } from "@/lib/types";
import { buildCaption, sendTelegram } from "./telegram";

export async function notifyShop(
  record: OrderRecord,
  pdf: Uint8Array,
  pdfFileName: string,
  settings: ShopSettings,
): Promise<NotifyResult> {
  try {
    const env = getOrderEnv();
    if (env.ORDER_TRANSPORT === "telegram") {
      return await sendTelegram(record, pdf, pdfFileName, settings, {
        token: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_CHAT_ID,
      });
    }
    // The caption holds the customer's phone and address. On Vercel the console is the platform
    // log, so only non-personal facts go there; locally the full caption is the intended dev view.
    console.log(
      process.env.VERCEL === "1"
        ? `[order] ${pdfFileName} (${pdf.byteLength} bytes) ${record.displayNo}`
        : `[order] ${pdfFileName} (${pdf.byteLength} bytes)\n${buildCaption(record, settings)}`,
    );
    return { telegram: "skipped" };
  } catch (e) {
    return {
      telegram: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
