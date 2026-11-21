'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guard';
import { pdfFileNameFor } from '@/lib/display-no';
import { notifyShop } from '@/lib/notify';
import { orderPriceView } from '@/lib/order-price-view';
import { getSettings } from '@/lib/settings';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';

/**
 * What the browser is told. Fixed states only: the raw error text from Telegram can hold API
 * details, so it is never returned.
 */
export type TelegramResendState = {
  status: 'idle' | 'sent' | 'failed' | 'not_configured' | 'missing_file' | 'not_found';
};

/**
 * Orders list: send an order's print PDF to Telegram again (useActionState shape).
 * Reuses notifyShop (the same path as a new order), then stores the delivery state on the
 * order. An order that is already 'sent' is never sent twice, and a stored 'sent' is never
 * downgraded.
 */
export async function resendTelegramAction(
  _prev: TelegramResendState,
  formData: FormData,
): Promise<TelegramResendState> {
  await requireAdmin();
  const orderId = String(formData.get('orderId') ?? '');
  if (!ID_RE.test(orderId)) return { status: 'not_found' };

  const storage = getStorage();
  const record = await storage.getOrder(orderId);
  if (!record) return { status: 'not_found' };
  if (record.notified.telegram === 'sent') return { status: 'sent' };

  const pdf = await storage.readFile(record.files.pdfPath).catch(() => null);
  if (!pdf) return { status: 'missing_file' };

  const settings = await getSettings();
  const fileName = pdfFileNameFor(record.displayNo, record.spec, orderPriceView(record).sheets ?? 0);
  const result = await notifyShop(record, pdf, fileName, settings);
  // Only the order id and the error text (no caption, phone or address) may reach the log.
  if (result.error) console.error('[telegram-resend] failed', orderId, result.error);

  // Another click may have delivered it while this one was sending: never downgrade 'sent'.
  const latest = await storage.getOrder(orderId).catch(() => null);
  if (result.telegram === 'sent' || (latest ?? record).notified.telegram !== 'sent') {
    try {
      await storage.updateOrder(orderId, { notified: { telegram: result.telegram } });
    } catch {
      console.error('[telegram-resend] could not save the state', orderId);
    }
  }
  revalidatePath('/admin');
  revalidatePath(`/admin/orders/${orderId}`);

  if (result.telegram === 'sent') return { status: 'sent' };
  return { status: result.telegram === 'skipped' ? 'not_configured' : 'failed' };
}
