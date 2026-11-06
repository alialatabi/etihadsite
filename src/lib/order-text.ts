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
 */
import type { OrderSummary } from '@/lib/types';

export function orderSummaryText(summary: OrderSummary): string {
  void summary;
  throw new Error('NOT_IMPLEMENTED: orderSummaryText (Agent A)');
}

/** Arabic label for a shape (+ corners). 'circle' → "دائري", rect rounded → "مستطيل بزوايا دائرية", … */
export function shapeLabel(shape: OrderSummary['shape'], corners?: OrderSummary['corners']): string {
  void shape;
  void corners;
  throw new Error('NOT_IMPLEMENTED: shapeLabel (Agent A)');
}

/** "3 × 4.24 سم" */
export function sizeLabel(widthUm: number, heightUm: number): string {
  void widthUm;
  void heightUm;
  throw new Error('NOT_IMPLEMENTED: sizeLabel (Agent A)');
}
