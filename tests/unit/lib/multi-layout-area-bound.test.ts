/**
 * The area bound of the multi-design packer must not undercount what fits when rotation is on and the
 * vertical gap is smaller than the horizontal one: a turned cell owns (h + gapX) x (w + gapY), which is
 * the smaller footprint then. Before the fix the bound capped each design at 28 copies.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { computeLayout, computeMultiLayout, layoutParamsFor } from '@/lib/layout';
import type { LayoutSettings, StickerSpec } from '@/lib/types';

const a: StickerSpec = { shape: 'custom', widthUm: 5000, heightUm: 98000 };
const b: StickerSpec = { shape: 'custom', widthUm: 5001, heightUm: 98000 };

describe('computeMultiLayout area bound with rotation and unequal gaps', () => {
  const settings: LayoutSettings = { ...DEFAULT_SETTINGS.layout, allowRotate: true, customGapUm: 6000, customGapYUm: 0 };

  it('fits about half of what each design fits alone, not a quarter', () => {
    const alone = [a, b].map((s) => {
      const r = computeLayout(s, layoutParamsFor(s, settings));
      if (!r.ok) throw new Error(r.reason);
      return r.layout.countPerSheet;
    });
    const out = computeMultiLayout([a, b], settings);
    if (!out.ok) throw new Error(out.reason);
    // Two designs share the sheet: each gets close to half of its own single-design count.
    expect(out.layout.perDesign).toBeGreaterThanOrEqual(Math.floor(Math.min(...alone) / 2) - 2);
    expect(out.layout.countPerSheet).toBe(2 * out.layout.perDesign);
  });

  it('is unchanged (values taken before the fix) when the gaps are equal or rotation is off', () => {
    const per = (st: LayoutSettings) => {
      const o = computeMultiLayout([a, b], st);
      return o.ok ? o.layout.perDesign : o.reason;
    };
    const base: LayoutSettings = { ...DEFAULT_SETTINGS.layout, allowRotate: true };
    expect(per({ ...base, customGapUm: 3000, customGapYUm: 3000 })).toBe(34);
    expect(per({ ...base, allowRotate: false })).toBe(29);
  });
});
