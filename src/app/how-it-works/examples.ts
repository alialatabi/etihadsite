import { computeLayout, layoutParamsFor } from '@/lib/layout';
import { enabledMaterials, priceFor, sortedTiers } from '@/lib/pricing';
import { cmToUm } from '@/lib/units';
import type { LayoutResult, LayoutSettings, Material, PricingSettings, ShopSettings, StickerSpec } from '@/lib/types';

export type ExampleKey = 'circle3' | 'circle5' | 'sharp5' | 'rounded5' | 'custom5';

export interface ExampleRow {
  key: ExampleKey;
  /** Sizes in cm, for the label. */
  size?: number;
  w?: number;
  h?: number;
  /** null when the size does not fit / is invalid. */
  count: number | null;
}

const EXAMPLES: { key: ExampleKey; spec: StickerSpec; label: Pick<ExampleRow, 'size' | 'w' | 'h'> }[] = [
  { key: 'circle3', spec: { shape: 'circle', widthUm: cmToUm(3), heightUm: cmToUm(3) }, label: { size: 3 } },
  { key: 'circle5', spec: { shape: 'circle', widthUm: cmToUm(5), heightUm: cmToUm(5) }, label: { size: 5 } },
  { key: 'sharp5', spec: { shape: 'rect', corners: 'sharp', widthUm: cmToUm(5), heightUm: cmToUm(5) }, label: { w: 5, h: 5 } },
  { key: 'rounded5', spec: { shape: 'rect', corners: 'rounded', widthUm: cmToUm(5), heightUm: cmToUm(5) }, label: { w: 5, h: 5 } },
  { key: 'custom5', spec: { shape: 'custom', widthUm: cmToUm(5), heightUm: cmToUm(3) }, label: { w: 5, h: 3 } },
];

/** Run the real layout engine for the examples shown on /how-it-works. */
export function computeExamples(layout: LayoutSettings): ExampleRow[] {
  return EXAMPLES.map(({ key, spec, label }) => {
    const out = computeLayout(spec, layoutParamsFor(spec, layout));
    return { key, ...label, count: out.ok ? out.layout.countPerSheet : null };
  });
}

/** Layout of the 3 cm circle sheet used by the illustration. */
export function illustrationLayout(layout: LayoutSettings): LayoutResult | null {
  const spec = EXAMPLES[0].spec;
  const out = computeLayout(spec, layoutParamsFor(spec, layout));
  return out.ok ? out.layout : null;
}

/**
 * Rows of the volume-discount table: sheets `from`…`to` (`to` null = and above) get `percent` off.
 * Starts at pricing.minSheets with a 0 % row unless a tier already applies there; tiers that end
 * below the minimum order are left out.
 */
export function discountRows(pricing: PricingSettings): { from: number; to: number | null; percent: number }[] {
  const tiers = sortedTiers(pricing.tiers);
  const rows: { from: number; to: number | null; percent: number }[] = [];
  if (tiers.length === 0 || tiers[0].minSheets > pricing.minSheets) {
    rows.push({ from: pricing.minSheets, to: tiers.length ? tiers[0].minSheets - 1 : null, percent: 0 });
  }
  tiers.forEach((tier, i) => {
    if (i + 1 < tiers.length && tiers[i + 1].minSheets <= pricing.minSheets) return;
    rows.push({ from: Math.max(tier.minSheets, pricing.minSheets), to: i + 1 < tiers.length ? tiers[i + 1].minSheets - 1 : null, percent: tier.percent });
  });
  return rows;
}

/** Sheet count of the worked price example, before it is clamped into the shop's min…max. */
const EXAMPLE_SHEETS = 50;

/**
 * The worked price example under the discount table: plastic when it is enabled, otherwise the
 * first enabled material. `price` is the subtotal in IQD (before delivery).
 * null when prices are not published or no material is enabled.
 */
export function priceExample(settings: ShopSettings): { material: Material; sheets: number; price: number } | null {
  const pricing = settings.pricing;
  const mats = enabledMaterials(pricing);
  const exMaterial = mats.includes('plastic') ? 'plastic' : mats[0];
  const exSheets = Math.min(Math.max(EXAMPLE_SHEETS, pricing.minSheets), pricing.maxSheets);
  const example =
    settings.pricesPublished && exMaterial
      ? priceFor(exMaterial, exSheets, 1, settings)
      : null;
  return example && example.subtotalIqd !== null && exMaterial
    ? { material: exMaterial, sheets: exSheets, price: example.subtotalIqd }
    : null;
}
