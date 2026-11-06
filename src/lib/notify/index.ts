import 'server-only';
/**
 * Shop notification — OWNED BY AGENT D.
 *
 * ORDER_TRANSPORT=console (default): log the Arabic summary, return { telegram: 'skipped' }.
 * ORDER_TRANSPORT=telegram: Bot API sendDocument (multipart) with the PDF as
 * `document` (filename from `pdfFileName`), `caption` = Arabic summary (≤ 1024
 * chars, HTML parse_mode, phone as tel:/wa.me links), chat_id = settings.telegramChatId.
 * Never throw: return { telegram: 'failed', error } on any failure.
 */
import type { NotifyResult, OrderRecord, ShopSettings } from '@/lib/types';

export async function notifyShop(
  record: OrderRecord,
  pdf: Uint8Array,
  pdfFileName: string,
  settings: ShopSettings,
): Promise<NotifyResult> {
  void record;
  void pdf;
  void pdfFileName;
  void settings;
  throw new Error('NOT_IMPLEMENTED: notifyShop (Agent D)');
}
