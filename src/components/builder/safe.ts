/**
 * Defensive wrappers around the lib modules the builder renders from. If one of them throws,
 * one widget may degrade (a plainer label, no price) but the page must not go blank, and the
 * WhatsApp fallback text (degraded.ts) must always be producible. The try/catch blocks are
 * deliberate even where the wrapped function cannot throw today.
 */
import { builder, common } from '@/content/ar';
import { computeLayout, layoutParamsFor, deriveLockedSize, maxWidthFor } from '@/lib/layout';
import { formatCm, parseCm } from '@/lib/parse/cm';
import { countLabel } from '@/lib/plural';
import { priceFor } from '@/lib/pricing';
import { shapeLabel, sizeLabel } from '@/lib/order-text';
import type {
  LayoutOutcome,
  LayoutSettings,
  Material,
  OrderSummary,
  PriceBreakdown,
  Shape,
  ShopSettings,
  StickerSpec,
} from '@/lib/types';

export function safeParseCm(input: string): number | null {
  try {
    return parseCm(input);
  } catch {
    return null;
  }
}

export function safeFormatCm(um: number): string {
  try {
    return formatCm(um);
  } catch {
    return String(Math.round(um / 100) / 100);
  }
}

export function safeLayout(spec: StickerSpec, layoutSettings: LayoutSettings): LayoutOutcome {
  try {
    return computeLayout(spec, layoutParamsFor(spec, layoutSettings));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export function safeDerive(
  shape: Shape,
  aspect: number,
  given: { widthUm: number } | { heightUm: number },
): { widthUm: number; heightUm: number } {
  try {
    return deriveLockedSize(shape, aspect, given);
  } catch {
    // Plain-math fallback so the form keeps working if the sibling throws.
    const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
    if ('widthUm' in given) {
      const w = given.widthUm;
      return { widthUm: w, heightUm: shape === 'circle' ? w : Math.round(w / a) };
    }
    const h = given.heightUm;
    return { widthUm: shape === 'circle' ? h : Math.round(h * a), heightUm: h };
  }
}

/** Largest width (µm) for `aspect`; null when unavailable. */
export function safeMaxWidth(aspect: number, spec: StickerSpec, layoutSettings: LayoutSettings): number | null {
  try {
    return maxWidthFor(aspect, layoutParamsFor(spec, layoutSettings));
  } catch {
    return null;
  }
}

export function safeCountLabel(n: number): string {
  try {
    return countLabel(n, common.plural.sticker);
  } catch {
    return String(n);
  }
}

export function safePrice(material: Material, sheets: number, countPerSheet: number, settings: ShopSettings): PriceBreakdown {
  try {
    return priceFor(material, sheets, countPerSheet, settings);
  } catch {
    return {
      material,
      sheets,
      unitBaseIqd: null,
      discountPercent: 0,
      unitPriceIqd: null,
      subtotalIqd: null,
      deliveryFeeIqd: settings.deliveryFeeIqd,
      totalIqd: null,
      totalStickers: sheets * countPerSheet,
      perStickerIqd: null,
    };
  }
}

export function safeShapeLabel(shape: Shape, corners?: OrderSummary['corners']): string {
  try {
    return shapeLabel(shape, corners);
  } catch {
    if (shape === 'rect') return corners === 'sharp' ? builder.shape.sharp : builder.shape.rounded;
    return builder.shape[shape];
  }
}

export function safeSizeLabel(widthUm: number, heightUm: number): string {
  try {
    return sizeLabel(widthUm, heightUm);
  } catch {
    return `${safeFormatCm(widthUm)} × ${safeFormatCm(heightUm)} ${common.units.cm}`;
  }
}
