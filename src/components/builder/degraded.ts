import { builder, common, fill } from '@/content/ar';
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
    ...(s.requestedStickers != null ? [`${builder.summary.requestedStickers}: ${s.requestedStickers}`] : []),
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
    // The shared builder writes the designs block itself for a multi-design order (summary.designs).
    body = orderSummaryText({ ...s, displayNo: '—' });
  } catch {
    body = manualSummaryText(s);
    // The manual fallback has no designs block: the size of every design and what each one gets.
    if (s.designs && s.designs.length > 0) {
      const lines = s.designs.map(
        (d, i) => `${fill(builder.multi.designN, { n: i + 1 })}: ${safeFormatCm(d.widthUm)} × ${safeFormatCm(d.heightUm)} ${common.units.cm}`,
      );
      if (s.perDesign != null) lines.push(`${builder.multi.perDesign}: ${s.sheets * s.perDesign}`);
      body = [body, ...lines].join('\n');
    }
  }
  return [builder.whatsappText.newOrder, body].join('\n');
}

export function degradedUrl(whatsapp: string, s: SummaryData | null): string | null {
  if (!whatsapp) return null;
  return whatsappUrl(whatsapp, s ? degradedText(s) : builder.whatsappText.newOrder);
}
