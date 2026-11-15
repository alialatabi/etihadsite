import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { parseStoredSettings, shopSettingsSchema } from '@/lib/storage/settings-schema';
import type { LayoutSettings, StickerSpec } from '@/lib/types';
import { computeLayout, layoutParamsFor } from './index';
import { resolveShapeSpacing, SHAPE_KEYS, shapeKeyOf, type ShapeKey } from './spacing';

/** Settings as stored before per-shape spacing: every distance different, none of the new keys. */
const OLD: LayoutSettings = {
  marginUm: 6_000,
  circleGapXUm: 2_000,
  circleGapYUm: 500,
  rectRoundedGapUm: 2_500,
  rectSharpGapUm: 1_000,
  customGapUm: 1_500,
  roundedRadiusUm: 3_000,
  allowRotate: false,
  minSideUm: 5_000,
};

const SPECS: Record<ShapeKey, StickerSpec> = {
  circle: { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
  rounded: { shape: 'rect', corners: 'rounded', widthUm: 40_000, heightUm: 30_000 },
  sharp: { shape: 'rect', corners: 'sharp', widthUm: 40_000, heightUm: 30_000 },
  custom: { shape: 'custom', widthUm: 40_000, heightUm: 30_000 },
};

describe('shapeKeyOf', () => {
  it('maps a spec to its spacing group', () => {
    expect(shapeKeyOf(SPECS.circle)).toBe('circle');
    expect(shapeKeyOf(SPECS.rounded)).toBe('rounded');
    expect(shapeKeyOf(SPECS.sharp)).toBe('sharp');
    expect(shapeKeyOf(SPECS.custom)).toBe('custom');
  });
  it('a rect without corners counts as rounded, like its clip', () => {
    expect(shapeKeyOf({ shape: 'rect', widthUm: 1, heightUm: 1 })).toBe('rounded');
  });
  it('SHAPE_KEYS lists the four keys in form order', () => {
    expect(SHAPE_KEYS).toEqual(['circle', 'rounded', 'sharp', 'custom']);
  });
});

describe('resolveShapeSpacing', () => {
  it('without the new keys: margin = general margin, vertical gap = the shape gap (circle keeps its own Y)', () => {
    expect(resolveShapeSpacing(OLD, 'circle')).toEqual({ marginUm: 6_000, gapXUm: 2_000, gapYUm: 500 });
    expect(resolveShapeSpacing(OLD, 'rounded')).toEqual({ marginUm: 6_000, gapXUm: 2_500, gapYUm: 2_500 });
    expect(resolveShapeSpacing(OLD, 'sharp')).toEqual({ marginUm: 6_000, gapXUm: 1_000, gapYUm: 1_000 });
    expect(resolveShapeSpacing(OLD, 'custom')).toEqual({ marginUm: 6_000, gapXUm: 1_500, gapYUm: 1_500 });
  });

  it('each override applies to its own shape only', () => {
    const s: LayoutSettings = { ...OLD, roundedMarginUm: 4_000, rectRoundedGapYUm: 700 };
    expect(resolveShapeSpacing(s, 'rounded')).toEqual({ marginUm: 4_000, gapXUm: 2_500, gapYUm: 700 });
    expect(resolveShapeSpacing(s, 'circle')).toEqual(resolveShapeSpacing(OLD, 'circle'));
    expect(resolveShapeSpacing(s, 'sharp')).toEqual(resolveShapeSpacing(OLD, 'sharp'));
    expect(resolveShapeSpacing(s, 'custom')).toEqual(resolveShapeSpacing(OLD, 'custom'));
  });

  it('every key of every shape is read', () => {
    const s: LayoutSettings = {
      ...OLD,
      circleMarginUm: 1_000,
      roundedMarginUm: 2_000,
      sharpMarginUm: 3_000,
      customMarginUm: 4_000,
      rectRoundedGapYUm: 11,
      rectSharpGapYUm: 22,
      customGapYUm: 33,
    };
    expect(resolveShapeSpacing(s, 'circle')).toEqual({ marginUm: 1_000, gapXUm: 2_000, gapYUm: 500 });
    expect(resolveShapeSpacing(s, 'rounded')).toEqual({ marginUm: 2_000, gapXUm: 2_500, gapYUm: 11 });
    expect(resolveShapeSpacing(s, 'sharp')).toEqual({ marginUm: 3_000, gapXUm: 1_000, gapYUm: 22 });
    expect(resolveShapeSpacing(s, 'custom')).toEqual({ marginUm: 4_000, gapXUm: 1_500, gapYUm: 33 });
  });

  it('an override of 0 is a real value, not a missing one', () => {
    const s: LayoutSettings = { ...OLD, sharpMarginUm: 0, rectSharpGapYUm: 0 };
    expect(resolveShapeSpacing(s, 'sharp')).toEqual({ marginUm: 0, gapXUm: 1_000, gapYUm: 0 });
  });
});

describe('layoutParamsFor with per-shape spacing', () => {
  it('new keys absent: the old single margin and gaps, for every shape', () => {
    for (const key of SHAPE_KEYS) {
      const p = layoutParamsFor(SPECS[key], OLD);
      const sp = resolveShapeSpacing(OLD, key);
      expect([p.marginUm, p.gapXUm, p.gapYUm]).toEqual([sp.marginUm, sp.gapXUm, sp.gapYUm]);
      expect(p.marginUm).toBe(OLD.marginUm);
    }
    expect(layoutParamsFor(SPECS.rounded, OLD)).toMatchObject({ gapXUm: 2_500, gapYUm: 2_500 });
    expect(layoutParamsFor(SPECS.sharp, OLD)).toMatchObject({ gapXUm: 1_000, gapYUm: 1_000 });
    expect(layoutParamsFor(SPECS.custom, OLD)).toMatchObject({ gapXUm: 1_500, gapYUm: 1_500 });
  });

  it('new keys present: margin, gap X and gap Y of each shape come from its own keys', () => {
    const s: LayoutSettings = {
      ...OLD,
      circleMarginUm: 3_000,
      roundedMarginUm: 4_000,
      sharpMarginUm: 5_000,
      customMarginUm: 7_000,
      rectRoundedGapYUm: 1_000,
      rectSharpGapYUm: 2_000,
      customGapYUm: 3_000,
    };
    expect(layoutParamsFor(SPECS.circle, s)).toMatchObject({ marginUm: 3_000, gapXUm: 2_000, gapYUm: 500, clip: { kind: 'circle' } });
    expect(layoutParamsFor(SPECS.rounded, s)).toMatchObject({ marginUm: 4_000, gapXUm: 2_500, gapYUm: 1_000, clip: { kind: 'roundedRect', radiusUm: 3_000 } });
    expect(layoutParamsFor(SPECS.sharp, s)).toMatchObject({ marginUm: 5_000, gapXUm: 1_000, gapYUm: 2_000, clip: { kind: 'none' } });
    expect(layoutParamsFor(SPECS.custom, s)).toMatchObject({ marginUm: 7_000, gapXUm: 1_500, gapYUm: 3_000, clip: { kind: 'none' } });
  });

  it('the engine uses them: the result carries the shape margin and gaps', () => {
    const s: LayoutSettings = { ...OLD, sharpMarginUm: 9_000, rectSharpGapUm: 2_000, rectSharpGapYUm: 4_000 };
    const out = computeLayout(SPECS.sharp, layoutParamsFor(SPECS.sharp, s));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.layout.marginUm).toBe(9_000);
    expect(out.layout.gapXUm).toBe(2_000);
    expect(out.layout.gapYUm).toBe(4_000);
    // A different shape of the same settings is not affected.
    const other = computeLayout(SPECS.custom, layoutParamsFor(SPECS.custom, s));
    expect(other.ok && other.layout.marginUm).toBe(OLD.marginUm);
  });

  it('absent keys give exactly the layout of the same settings with the fallbacks written out', () => {
    for (const key of SHAPE_KEYS) {
      const sp = resolveShapeSpacing(OLD, key);
      const explicit: LayoutSettings = {
        ...OLD,
        circleMarginUm: sp.marginUm,
        roundedMarginUm: sp.marginUm,
        sharpMarginUm: sp.marginUm,
        customMarginUm: sp.marginUm,
        rectRoundedGapYUm: resolveShapeSpacing(OLD, 'rounded').gapYUm,
        rectSharpGapYUm: resolveShapeSpacing(OLD, 'sharp').gapYUm,
        customGapYUm: resolveShapeSpacing(OLD, 'custom').gapYUm,
      };
      expect(computeLayout(SPECS[key], layoutParamsFor(SPECS[key], explicit))).toEqual(
        computeLayout(SPECS[key], layoutParamsFor(SPECS[key], OLD)),
      );
    }
  });
});

describe('settings schema and the per-shape keys', () => {
  const settingsWith = (layout: Record<string, unknown>) => ({ ...structuredClone(DEFAULT_SETTINGS), layout: { ...DEFAULT_SETTINGS.layout, ...layout } });

  it('keeps the new keys (a plain z.object would strip them)', () => {
    const layout = {
      circleMarginUm: 1_000,
      roundedMarginUm: 2_000,
      sharpMarginUm: 3_000,
      customMarginUm: 4_000,
      rectRoundedGapYUm: 500,
      rectSharpGapYUm: 600,
      customGapYUm: 700,
    };
    const r = shopSettingsSchema.safeParse(settingsWith(layout));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.layout).toMatchObject(layout);
  });

  it('settings stored without the new keys still parse, and stay without them', () => {
    const stored = { layout: { marginUm: 5_000 } };
    const r = parseStoredSettings(stored);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings.layout.marginUm).toBe(5_000);
    expect(r.settings.layout.circleMarginUm).toBeUndefined();
    expect(r.settings.layout.rectSharpGapYUm).toBeUndefined();
    expect(resolveShapeSpacing(r.settings.layout, 'custom').marginUm).toBe(5_000);
  });

  it('stored settings with the new keys survive the merge over the defaults', () => {
    const r = parseStoredSettings({ layout: { sharpMarginUm: 8_000, customGapYUm: 1_200 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.layout).toMatchObject({ sharpMarginUm: 8_000, customGapYUm: 1_200 });
  });

  it('rejects out-of-range or fractional values', () => {
    for (const key of ['circleMarginUm', 'roundedMarginUm', 'sharpMarginUm', 'customMarginUm', 'rectRoundedGapYUm', 'rectSharpGapYUm', 'customGapYUm']) {
      expect(shopSettingsSchema.safeParse(settingsWith({ [key]: -1 })).success, `${key} -1`).toBe(false);
      expect(shopSettingsSchema.safeParse(settingsWith({ [key]: 50_001 })).success, `${key} too big`).toBe(false);
      expect(shopSettingsSchema.safeParse(settingsWith({ [key]: 1.5 })).success, `${key} 1.5`).toBe(false);
    }
  });

  it('the defaults do not carry the new keys (stored values must not be overridden by the merge)', () => {
    for (const key of ['circleMarginUm', 'roundedMarginUm', 'sharpMarginUm', 'customMarginUm', 'rectRoundedGapYUm', 'rectSharpGapYUm', 'customGapYUm']) {
      expect(DEFAULT_SETTINGS.layout).not.toHaveProperty(key);
    }
  });
});
