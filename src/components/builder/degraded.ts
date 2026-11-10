import { builder, common } from '@/content/ar';
import { orderSummaryText } from '@/lib/order-text';
import { formatIqd } from '@/lib/pricing';
import { whatsappUrl } from '@/lib/parse/phone';
import { safeFormatCm, safeShapeLabel } from './safe';
import type { SummaryData } from './logic';

/** Plain-text summary when `orderSummaryText` is unavailable. Uses only dictionary labels. */
export function manualSummaryText(s: SummaryData): string {
  const money = (n: number) => `${formatIqd(n)} ${common.units.iqd}`;
  const sizeText = `${safeFormatCm(s.widthUm)} × ${safeFormatCm(s.heightUm)} ${common.units.cm}`;
  return [
    `${builder.summary.shape}: ${safeShapeLabel(s.shape, s.corners)}`,
    `${builder.summary.size}: ${sizeText}`,
    `${builder.summary.perSheet}: ${s.countPerSheet}`,
    `${builder.summary.material}: ${common.materials[s.material]}`,
    `${builder.summary.sheets}: ${s.sheets}`,
    `${builder.summary.totalStickers}: ${s.totalStickers}`,
    ...(s.discountPercent > 0 ? [`${builder.summary.discount}: ${s.discountPercent}%`] : []),
    `${builder.summary.unitPrice}: ${s.unitPriceIqd == null ? builder.summary.priceUnset : money(s.unitPriceIqd)}`,
    `${builder.summary.delivery}: ${money(s.deliveryFeeIqd)}`,
    `${builder.summary.total}: ${s.totalIqd == null ? builder.summary.priceUnset : money(s.totalIqd)}`,
  ].join('\n');
}

/** WhatsApp text for the degraded path: intro line + summary (shared builder, manual fallback). */
export function degradedText(s: SummaryData): string {
  let body: string;
  try {
    body = orderSummaryText({ ...s, displayNo: '—' });
  } catch {
    body = manualSummaryText(s);
  }
  return `${builder.whatsappText.newOrder}\n${body}`;
}

export function degradedUrl(whatsapp: string, s: SummaryData | null): string | null {
  if (!whatsapp) return null;
  return whatsappUrl(whatsapp, s ? degradedText(s) : builder.whatsappText.newOrder);
}
