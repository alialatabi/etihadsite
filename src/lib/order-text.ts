/**
 * Arabic order-summary text builders. Pure; used on the server and in the browser.
 *
 * orderSummaryText() is the body of the WhatsApp text that POST /api/orders returns and of
 * the builder's degraded (send-it-yourself) message. The Telegram caption is built apart, by
 * buildCaption() in src/lib/notify/telegram.ts; it shares only shapeLabel() and sizeLabel(),
 * which the admin order pages and the builder summary use too.
 * Western digits; wrap nothing in HTML here — plain text with line breaks.
 *
 * Example (3 cm circle, 20 sheets, price unset):
 *   طلب جديد — EP-251107-AB3C
 *   الشكل: دائري
 *   القياس: 3 × 3 سم
 *   بالورقة: 54 ستيكر
 *   الخامة: ورقي
 *   الأوراق: 20 ورقة (1080 ستيكر)
 *   السعر: يُحدد عند التأكيد
 *   التوصيل: 5,000 د.ع
 *
 * When the total is known, a final "الإجمالي: … د.ع" line is appended.
 */
import type { OrderSummary } from '@/lib/types';
import { common, fill, order } from '@/content/ar';
import { formatCm } from '@/lib/parse/cm';
import { countLabel } from '@/lib/plural';
import { formatIqd } from '@/lib/pricing';

const money = (n: number): string => `${formatIqd(n)} ${common.units.iqd}`;

export function orderSummaryText(summary: OrderSummary): string {
  const T = order.text;
  const lines = [
    `${T.newOrder} — ${summary.displayNo}`,
    `${T.shape}: ${shapeLabel(summary.shape, summary.corners)}`,
    `${T.size}: ${sizeLabel(summary.widthUm, summary.heightUm)}`,
    `${T.perSheet}: ${countLabel(summary.countPerSheet, common.plural.sticker)}`,
    `${T.material}: ${common.materials[summary.material]}`,
    `${T.sheets}: ${countLabel(summary.sheets, common.plural.sheet)} (${countLabel(summary.totalStickers, common.plural.sticker)})`,
  ];
  if (summary.unitPriceIqd === null) {
    lines.push(`${T.price}: ${T.priceUnset}`);
  } else {
    const disc = summary.discountPercent > 0 ? ` (${fill(T.discount, { percent: summary.discountPercent })})` : '';
    lines.push(`${T.unitPrice}: ${money(summary.unitPriceIqd)}${disc}`);
    if (summary.subtotalIqd !== null) lines.push(`${T.subtotal}: ${money(summary.subtotalIqd)}`);
  }
  lines.push(`${T.delivery}: ${money(summary.deliveryFeeIqd)}`);
  if (summary.totalIqd !== null) lines.push(`${T.total}: ${money(summary.totalIqd)}`);
  return lines.join('\n');
}

/** Arabic label for a shape (+ corners). 'circle' → "دائري", rect rounded → "مستطيل بزوايا دائرية", … */
export function shapeLabel(shape: OrderSummary['shape'], corners?: OrderSummary['corners']): string {
  if (shape === 'circle') return order.shapes.circle;
  if (shape === 'custom') return order.shapes.custom;
  return corners === 'sharp' ? order.shapes.rectSharp : order.shapes.rectRounded;
}

/** "3 × 4.24 سم" */
export function sizeLabel(widthUm: number, heightUm: number): string {
  return `${formatCm(widthUm)} × ${formatCm(heightUm)} ${common.units.cm}`;
}
