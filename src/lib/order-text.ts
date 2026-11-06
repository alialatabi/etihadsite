/**
 * Shared Arabic order-summary text builders — OWNED BY AGENT A (pure, both runtimes).
 *
 * The SAME text is used in: the summary card (C), the WhatsApp pre-filled
 * message (C + D), the Telegram caption (D) and the admin order view (D).
 * Western digits; wrap nothing in HTML here — plain text with line breaks.
 *
 * Example (3 cm circle, 20 sheets, price unset):
 *   طلب جديد — EP-251107-AB3C
 *   الشكل: دائري
 *   القياس: 3 × 3 سم
 *   بالورقة: 54 ستيكر
 *   الأوراق: 20 ورقة (1080 ستيكر)
 *   السعر: يُحدد عند التأكيد
 *   التوصيل: 5,000 د.ع
 *
 * When the total is known, a final "الإجمالي: … د.ع" line is appended.
 */
import type { OrderSummary } from '@/lib/types';
import { common } from '@/content/ar/common';
import { formatCm } from '@/lib/parse/cm';
import { countLabel } from '@/lib/plural';
import { formatIqd } from '@/lib/pricing';

const money = (n: number): string => `${formatIqd(n)} ${common.units.iqd}`;

export function orderSummaryText(summary: OrderSummary): string {
  const lines = [
    `طلب جديد — ${summary.displayNo}`,
    `الشكل: ${shapeLabel(summary.shape, summary.corners)}`,
    `القياس: ${sizeLabel(summary.widthUm, summary.heightUm)}`,
    `بالورقة: ${countLabel(summary.countPerSheet, common.plural.sticker)}`,
    `الأوراق: ${countLabel(summary.sheets, common.plural.sheet)} (${countLabel(summary.totalStickers, common.plural.sticker)})`,
    `السعر: ${summary.offerPriceIqd === null ? 'يُحدد عند التأكيد' : money(summary.offerPriceIqd)}`,
    `التوصيل: ${money(summary.deliveryFeeIqd)}`,
  ];
  if (summary.totalIqd !== null) lines.push(`الإجمالي: ${money(summary.totalIqd)}`);
  return lines.join('\n');
}

/** Arabic label for a shape (+ corners). 'circle' → "دائري", rect rounded → "مستطيل بزوايا دائرية", … */
export function shapeLabel(shape: OrderSummary['shape'], corners?: OrderSummary['corners']): string {
  if (shape === 'circle') return 'دائري';
  if (shape === 'custom') return 'شكل مخصص';
  return corners === 'sharp' ? 'مستطيل بزوايا حادة' : 'مستطيل بزوايا دائرية';
}

/** "3 × 4.24 سم" */
export function sizeLabel(widthUm: number, heightUm: number): string {
  return `${formatCm(widthUm)} × ${formatCm(heightUm)} ${common.units.cm}`;
}
