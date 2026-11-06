import { computeLayout, layoutParamsFor } from '@/lib/layout';
import { cmToUm } from '@/lib/units';
import type { LayoutResult, LayoutSettings, StickerSpec } from '@/lib/types';

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
