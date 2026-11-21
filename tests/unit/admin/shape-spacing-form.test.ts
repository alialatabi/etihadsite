import { describe, expect, it } from 'vitest';
import { LAYOUT_MM_FIELDS, RADIUS_FIELD, SHAPE_SPACING_FIELDS } from '@/app/admin/settings/fields';
import { parseSettingsForm } from '@/app/admin/settings/parse-form';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { layoutParamsFor } from '@/lib/layout';
import { resolveShapeSpacing, SHAPE_KEYS, type ShapeKey } from '@/lib/layout/spacing';
import type { ShopSettings, StickerSpec } from '@/lib/types';
import { umToMm } from '@/lib/units';

/** Settings saved before per-shape spacing: none of the new layout keys. */
const OLD: ShopSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  layout: {
    marginUm: 6_000,
    circleGapXUm: 2_000,
    circleGapYUm: 500,
    rectRoundedGapUm: 2_500,
    rectSharpGapUm: 1_000,
    customGapUm: 1_500,
    roundedRadiusUm: 3_000,
    allowRotate: true,
    minSideUm: 5_000,
  },
};

/** What SettingsForm.tsx puts in each spacing input: the resolved value of its shape. */
function prefill(settings: ShopSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { shape, margin, gapX, gapY } of SHAPE_SPACING_FIELDS) {
    const now = resolveShapeSpacing(settings.layout, shape);
    out[margin.name] = String(umToMm(now.marginUm));
    out[gapX.name] = String(umToMm(now.gapXUm));
    out[gapY.name] = String(umToMm(now.gapYUm));
  }
  out[RADIUS_FIELD.name] = String(umToMm(settings.layout[RADIUS_FIELD.key]));
  return out;
}

/** A complete form for `settings`, as the browser would submit it, with `over` on top. */
function formFor(settings: ShopSettings, over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const pr = settings.pricing;
  const set = (k: string, v: string) => f.set(k, v);
  set('shopName', settings.shopName);
  set('tagline', settings.tagline);
  set('whatsapp', settings.whatsapp);
  set('phone', settings.phone);
  set('hours', settings.hours);
  set('area', settings.area);
  set('telegramChatId', settings.telegramChatId);
  set('paperPrice', String(pr.materials.paper.pricePerSheetIqd));
  set('plasticPrice', String(pr.materials.plastic.pricePerSheetIqd));
  if (pr.materials.paper.enabled) set('paperEnabled', 'on');
  if (pr.materials.plastic.enabled) set('plasticEnabled', 'on');
  set('minSheets', String(pr.minSheets));
  set('maxSheets', String(pr.maxSheets));
  set('tiers', JSON.stringify(pr.tiers.map((t) => ({ minSheets: String(t.minSheets), percent: String(t.percent) }))));
  set('quickPicks', pr.quickPicks.join(','));
  set('deliveryFeeIqd', String(settings.deliveryFeeIqd));
  if (settings.pricesPublished) set('pricesPublished', 'on');
  set('retentionDays', String(settings.retentionDays));
  if (settings.ai.enabled) set('aiEnabled', 'on');
  set('aiPerIp', String(settings.ai.perIpDailyLimit));
  set('aiSite', String(settings.ai.siteDailyLimit));
  if (settings.layout.allowRotate) set('allowRotate', 'on');
  for (const [k, v] of Object.entries({ ...prefill(settings), ...over })) set(k, v);
  return f;
}

const SPECS: Record<ShapeKey, StickerSpec> = {
  circle: { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
  rounded: { shape: 'rect', corners: 'rounded', widthUm: 40_000, heightUm: 30_000 },
  sharp: { shape: 'rect', corners: 'sharp', widthUm: 40_000, heightUm: 30_000 },
  custom: { shape: 'custom', widthUm: 40_000, heightUm: 30_000 },
};

const save = (settings: ShopSettings, over: Record<string, string> = {}): ShopSettings => {
  const r = parseSettingsForm(formFor(settings, over), settings);
  if (!r.ok) throw new Error(`form rejected: ${r.error}`);
  return r.settings;
};

describe('per-shape spacing form', () => {
  it('has three inputs per shape, with unique names, plus the radius', () => {
    expect(SHAPE_SPACING_FIELDS.map((g) => g.shape)).toEqual([...SHAPE_KEYS]);
    const names = LAYOUT_MM_FIELDS.map((f) => f.name);
    expect(names).toHaveLength(13);
    expect(new Set(names).size).toBe(13);
    expect(new Set(LAYOUT_MM_FIELDS.map((f) => f.key)).size).toBe(13);
  });

  it('settings saved before per-shape spacing prefill the fallback values', () => {
    expect(prefill(OLD)).toEqual({
      circleMargin: '6',
      circleGapX: '2',
      circleGapY: '0.5',
      roundedMargin: '6',
      roundedGapX: '2.5',
      roundedGapY: '2.5',
      sharpMargin: '6',
      sharpGapX: '1',
      sharpGapY: '1',
      customMargin: '6',
      customGapX: '1.5',
      customGapY: '1.5',
      roundedRadius: '3',
    });
  });

  it('saving the untouched prefill of old settings changes no printed layout', () => {
    const saved = save(OLD);
    for (const key of SHAPE_KEYS) {
      expect(layoutParamsFor(SPECS[key], saved.layout)).toEqual(layoutParamsFor(SPECS[key], OLD.layout));
    }
  });

  it('saving writes every per-shape key explicitly and keeps the general margin as the fallback', () => {
    const saved = save(OLD);
    expect(saved.layout).toEqual({
      marginUm: 6_000,
      circleMarginUm: 6_000,
      circleGapXUm: 2_000,
      circleGapYUm: 500,
      roundedMarginUm: 6_000,
      rectRoundedGapUm: 2_500,
      rectRoundedGapYUm: 2_500,
      sharpMarginUm: 6_000,
      rectSharpGapUm: 1_000,
      rectSharpGapYUm: 1_000,
      customMarginUm: 6_000,
      customGapUm: 1_500,
      customGapYUm: 1_500,
      roundedRadiusUm: 3_000,
      allowRotate: true,
      minSideUm: 5_000,
    });
  });

  it('changing one shape leaves the other three as they were', () => {
    const saved = save(OLD, { sharpMargin: '10', sharpGapX: '0', sharpGapY: '3' });
    expect(resolveShapeSpacing(saved.layout, 'sharp')).toEqual({ marginUm: 10_000, gapXUm: 0, gapYUm: 3_000 });
    for (const key of ['circle', 'rounded', 'custom'] as const) {
      expect(resolveShapeSpacing(saved.layout, key)).toEqual(resolveShapeSpacing(OLD.layout, key));
    }
    expect(layoutParamsFor(SPECS.sharp, saved.layout)).toMatchObject({ marginUm: 10_000, gapXUm: 0, gapYUm: 3_000 });
  });

  it('a form round trip is stable: saving the saved settings gives the same settings', () => {
    const once = save(OLD, { customMargin: '4', customGapY: '2' });
    expect(save(once)).toEqual(once);
  });

  it('rejects a blank, negative or too large per-shape value', () => {
    for (const { margin, gapX, gapY } of SHAPE_SPACING_FIELDS) {
      for (const { name } of [margin, gapX, gapY]) {
        for (const bad of ['', 'abc', '-1', '51']) {
          expect(parseSettingsForm(formFor(OLD, { [name]: bad }), OLD).ok, `${name}=${JSON.stringify(bad)}`).toBe(false);
        }
      }
    }
  });
});
