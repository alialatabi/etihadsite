import { describe, expect, it } from 'vitest';
import cases from '@/lib/__fixtures__/layout-cases.json';
import { A4_PT, A4_UM, umToPt } from '@/lib/units';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { governorates } from '@/content/ar';

/** Phase 0 sanity tests: fixtures and constants are internally consistent. */
describe('contracts', () => {
  it('A4 constants convert to the expected points', () => {
    expect(umToPt(A4_UM.widthUm)).toBeCloseTo(595.2756, 3);
    expect(umToPt(A4_UM.heightUm)).toBeCloseTo(841.8898, 3);
    expect(A4_PT.widthPt).toBeCloseTo(595.2756, 3);
  });

  it('fixture placements all lie inside the usable area', () => {
    for (const c of cases) {
      if (!c.expected.ok || !c.expected.layout) continue;
      const l = c.expected.layout;
      expect(l.placements).toHaveLength(l.countPerSheet);
      for (const p of l.placements) {
        expect(p.xUm).toBeGreaterThanOrEqual(l.usable.xUm);
        expect(p.yUm).toBeGreaterThanOrEqual(l.usable.yUm);
        const turned = 'turned' in p && p.turned === true;
        const w = turned ? l.cell.heightUm : l.cell.widthUm;
        const h = turned ? l.cell.widthUm : l.cell.heightUm;
        expect(p.xUm + w).toBeLessThanOrEqual(l.usable.xUm + l.usable.widthUm);
        expect(p.yUm + h).toBeLessThanOrEqual(l.usable.yUm + l.usable.heightUm);
      }
    }
  });

  it("owner's circle rule gives 54 per sheet for a 3 cm circle", () => {
    const c = cases.find((x) => x.name.startsWith('circle-30mm-gapX2-gapY0'));
    expect(c?.expected.ok && c.expected.layout?.countPerSheet).toBe(54);
    expect(DEFAULT_SETTINGS.layout.circleGapXUm).toBe(2000);
    expect(DEFAULT_SETTINGS.layout.circleGapYUm).toBe(0);
  });

  it('defaults carry the agreed business rules', () => {
    expect(DEFAULT_SETTINGS.deliveryFeeIqd).toBe(5000);
    expect(DEFAULT_SETTINGS.layout.marginUm).toBe(7000);
    const pr = DEFAULT_SETTINGS.pricing;
    expect(pr.minSheets).toBe(10);
    expect(pr.materials.paper.pricePerSheetIqd).toBe(800);
    expect(pr.materials.plastic.pricePerSheetIqd).toBe(1500);
    expect(pr.tiers.map((t) => [t.minSheets, t.percent])).toEqual([[20, 10], [50, 15], [100, 20]]);
    expect(pr.quickPicks).toEqual([10, 20, 50, 100]);
    expect(DEFAULT_SETTINGS.pricesPublished).toBe(true);
    expect(governorates).toHaveLength(19);
    expect(governorates[0]).toBe('بغداد');
  });
});
