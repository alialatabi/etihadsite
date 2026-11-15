/**
 * Per-shape sheet spacing: the ONE place where the fallbacks between the stored layout keys live.
 * Pure and isomorphic (type imports only): the layout engine, the admin form, the builder and the
 * how-it-works page all read the spacing through `resolveShapeSpacing`.
 *
 * Stored keys (src/lib/types.ts LayoutSettings), per shape:
 *   circle  : circleMarginUm?  circleGapXUm        circleGapYUm
 *   rounded : roundedMarginUm? rectRoundedGapUm    rectRoundedGapYUm?
 *   sharp   : sharpMarginUm?   rectSharpGapUm      rectSharpGapYUm?
 *   custom  : customMarginUm?  customGapUm         customGapYUm?
 * A missing margin falls back to the general `marginUm`; a missing vertical gap falls back to the
 * shape's horizontal gap (which is what the single gap used to mean).
 */
import type { LayoutSettings, StickerSpec } from '../types';

export type ShapeKey = 'circle' | 'rounded' | 'sharp' | 'custom';

/** Every shape key, in the order the admin form shows them. */
export const SHAPE_KEYS: readonly ShapeKey[] = ['circle', 'rounded', 'sharp', 'custom'];

export interface ShapeSpacing {
  /** Sheet margin on all four sides, µm. */
  marginUm: number;
  /** Gap between stickers along the page width, µm. */
  gapXUm: number;
  /** Gap between stickers along the page height, µm. */
  gapYUm: number;
}

/** Which spacing group a sticker belongs to (a rect without `corners` counts as rounded, like the clip). */
export function shapeKeyOf(spec: StickerSpec): ShapeKey {
  switch (spec.shape) {
    case 'circle':
      return 'circle';
    case 'rect':
      return spec.corners === 'sharp' ? 'sharp' : 'rounded';
    default:
      return 'custom';
  }
}

/** The margin and the two gaps in effect for `key`, with the fallbacks applied. */
export function resolveShapeSpacing(settings: LayoutSettings, key: ShapeKey): ShapeSpacing {
  switch (key) {
    case 'circle':
      return {
        marginUm: settings.circleMarginUm ?? settings.marginUm,
        gapXUm: settings.circleGapXUm,
        gapYUm: settings.circleGapYUm,
      };
    case 'rounded':
      return {
        marginUm: settings.roundedMarginUm ?? settings.marginUm,
        gapXUm: settings.rectRoundedGapUm,
        gapYUm: settings.rectRoundedGapYUm ?? settings.rectRoundedGapUm,
      };
    case 'sharp':
      return {
        marginUm: settings.sharpMarginUm ?? settings.marginUm,
        gapXUm: settings.rectSharpGapUm,
        gapYUm: settings.rectSharpGapYUm ?? settings.rectSharpGapUm,
      };
    case 'custom':
    default:
      return {
        marginUm: settings.customMarginUm ?? settings.marginUm,
        gapXUm: settings.customGapUm,
        gapYUm: settings.customGapYUm ?? settings.customGapUm,
      };
  }
}
