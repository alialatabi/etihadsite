/**
 * The layout distances of the settings form: typed in millimetres under `name`, stored in
 * micrometres under `key` of ShopSettings['layout']. One table for the form (SettingsForm.tsx,
 * a client component) and for the parser (parse-form.ts). Each shape has its own sheet margin,
 * horizontal gap and vertical gap (the form prefills them with resolveShapeSpacing, see
 * src/lib/layout/spacing.ts, which also holds the fallbacks for settings saved without them).
 * No runtime imports on purpose: this file is bundled for the browser and must stay free of zod.
 */
import type { ShapeKey } from '@/lib/layout/spacing';

interface SpacingGroup {
  shape: ShapeKey;
  margin: { name: string; key: 'circleMarginUm' | 'roundedMarginUm' | 'sharpMarginUm' | 'customMarginUm' };
  gapX: { name: string; key: 'circleGapXUm' | 'rectRoundedGapUm' | 'rectSharpGapUm' | 'customGapUm' };
  gapY: { name: string; key: 'circleGapYUm' | 'rectRoundedGapYUm' | 'rectSharpGapYUm' | 'customGapYUm' };
}

/** The four spacing groups, in the order the form shows them. */
export const SHAPE_SPACING_FIELDS: readonly SpacingGroup[] = [
  {
    shape: 'circle',
    margin: { name: 'circleMargin', key: 'circleMarginUm' },
    gapX: { name: 'circleGapX', key: 'circleGapXUm' },
    gapY: { name: 'circleGapY', key: 'circleGapYUm' },
  },
  {
    shape: 'rounded',
    margin: { name: 'roundedMargin', key: 'roundedMarginUm' },
    gapX: { name: 'roundedGapX', key: 'rectRoundedGapUm' },
    gapY: { name: 'roundedGapY', key: 'rectRoundedGapYUm' },
  },
  {
    shape: 'sharp',
    margin: { name: 'sharpMargin', key: 'sharpMarginUm' },
    gapX: { name: 'sharpGapX', key: 'rectSharpGapUm' },
    gapY: { name: 'sharpGapY', key: 'rectSharpGapYUm' },
  },
  {
    shape: 'custom',
    margin: { name: 'customMargin', key: 'customMarginUm' },
    gapX: { name: 'customGapX', key: 'customGapUm' },
    gapY: { name: 'customGapY', key: 'customGapYUm' },
  },
];

/** The corner radius of rounded rectangles: the one layout distance that is not per-shape spacing. */
export const RADIUS_FIELD = { name: 'roundedRadius', key: 'roundedRadiusUm' } as const;

type MmField = SpacingGroup['margin'] | SpacingGroup['gapX'] | SpacingGroup['gapY'] | typeof RADIUS_FIELD;

/** Every layout input the parser reads (name -> key), spacing groups first, then the radius. */
export const LAYOUT_MM_FIELDS: readonly MmField[] = [
  ...SHAPE_SPACING_FIELDS.flatMap((g) => [g.margin, g.gapX, g.gapY]),
  RADIUS_FIELD,
];
