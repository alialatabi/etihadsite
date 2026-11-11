import { describe, expect, it } from 'vitest';
import { parseSettingsForm } from '@/app/admin/settings/parse-form';
import { admin } from '@/content/ar';
import type { ShopSettings } from '@/lib/types';

const E = admin.settings.errors;
const INVALID = admin.settings.invalid;

/**
 * What is stored before the save. Not DEFAULT_SETTINGS on purpose: every layout value is
 * different, and quality / maxUploadBytes / layout.minSideUm (which the form does not carry)
 * differ from the defaults, so a value taken from the wrong place shows up.
 */
const CURRENT: ShopSettings = {
  shopName: 'Softy',
  tagline: 'Stickers',
  whatsapp: '9647701234567',
  phone: '0770 123 4567',
  hours: '10-8',
  area: 'Baghdad',
  telegramChatId: '-100123',
  pricing: {
    materials: {
      paper: { enabled: true, pricePerSheetIqd: 800 },
      plastic: { enabled: true, pricePerSheetIqd: 1_500 },
    },
    minSheets: 10,
    maxSheets: 5_000,
    tiers: [
      { minSheets: 20, percent: 10 },
      { minSheets: 50, percent: 15 },
    ],
    quickPicks: [10, 20, 50, 100],
  },
  deliveryFeeIqd: 5_000,
  pricesPublished: true,
  layout: {
    marginUm: 7_000,
    circleGapXUm: 2_000,
    circleGapYUm: 500,
    rectRoundedGapUm: 2_500,
    rectSharpGapUm: 1_000,
    customGapUm: 1_500,
    roundedRadiusUm: 3_000,
    allowRotate: false,
    minSideUm: 6_000,
  },
  quality: { warnDpi: 120, blockDpi: 60, targetDpi: 360 },
  maxUploadBytes: 5_000_000,
  retentionDays: 30,
};

type Overrides = Record<string, string | null>;
type TierCells = [string | number, string | number];

const tiersJson = (rows: TierCells[]) => JSON.stringify(rows.map(([minSheets, percent]) => ({ minSheets, percent })));

/**
 * The fields the settings form submits for CURRENT, with `overrides` on top. `null` leaves a
 * field out, which is what the browser does for an unchecked checkbox.
 */
function formOf(overrides: Overrides = {}): FormData {
  const c = CURRENT;
  const mm = (um: number) => String(um / 1000);
  const on = (checked: boolean) => (checked ? 'on' : null);
  const fields: Overrides = {
    shopName: c.shopName,
    tagline: c.tagline,
    whatsapp: c.whatsapp,
    phone: c.phone,
    hours: c.hours,
    area: c.area,
    telegramChatId: c.telegramChatId,
    paperPrice: String(c.pricing.materials.paper.pricePerSheetIqd),
    paperEnabled: on(c.pricing.materials.paper.enabled),
    plasticPrice: String(c.pricing.materials.plastic.pricePerSheetIqd),
    plasticEnabled: on(c.pricing.materials.plastic.enabled),
    minSheets: String(c.pricing.minSheets),
    maxSheets: String(c.pricing.maxSheets),
    tiers: tiersJson(c.pricing.tiers.map((t): TierCells => [String(t.minSheets), String(t.percent)])),
    quickPicks: c.pricing.quickPicks.join(','),
    deliveryFeeIqd: String(c.deliveryFeeIqd),
    pricesPublished: on(c.pricesPublished),
    margin: mm(c.layout.marginUm),
    circleGapX: mm(c.layout.circleGapXUm),
    circleGapY: mm(c.layout.circleGapYUm),
    roundedGap: mm(c.layout.rectRoundedGapUm),
    sharpGap: mm(c.layout.rectSharpGapUm),
    customGap: mm(c.layout.customGapUm),
    roundedRadius: mm(c.layout.roundedRadiusUm),
    retentionDays: String(c.retentionDays),
    allowRotate: on(c.layout.allowRotate),
    ...overrides,
  };
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) if (value !== null) form.set(name, value);
  return form;
}

const parse = (overrides: Overrides = {}) => parseSettingsForm(formOf(overrides), CURRENT);

/** The error message, or null when the form was accepted. */
const errorOf = (overrides: Overrides) => {
  const result = parse(overrides);
  return result.ok ? null : result.error;
};

/** The settings to save; fails the test when the form was rejected. */
const settingsOf = (overrides: Overrides = {}): ShopSettings => {
  const result = parse(overrides);
  if (!result.ok) throw new Error(`form rejected: ${result.error}`);
  return result.settings;
};

/**
 * The checks in the order the parser runs them. `alone` breaks only that rule; `stacked`
 * (default: `alone`) breaks that rule in a way that also breaks the later rules reading the
 * same field, so that rows can be merged into "this rule and every later one".
 */
const RULES: { rule: string; error: string; alone: Overrides; stacked?: Overrides }[] = [
  { rule: 'tiers is not a JSON array', error: INVALID, alone: { tiers: '{nope' } },
  { rule: 'noMaterial', error: E.noMaterial, alone: { paperEnabled: null, plasticEnabled: null } },
  { rule: 'minMax', error: E.minMax, alone: { minSheets: '300', maxSheets: '200' } },
  {
    rule: 'tiersMax',
    error: E.tiersMax,
    alone: { tiers: tiersJson(Array.from({ length: 21 }, (_, i): TierCells => [String(i + 20), '1'])) },
    stacked: { tiers: tiersJson(Array.from({ length: 21 }, (): TierCells => ['20', '91'])) },
  },
  {
    rule: 'duplicateTier',
    error: E.duplicateTier,
    alone: { tiers: tiersJson([['20', '10'], ['20', '15']]) },
    stacked: { tiers: tiersJson([['20', '91'], ['20', '91']]) },
  },
  { rule: 'tierPercent', error: E.tierPercent, alone: { tiers: tiersJson([['20', '91']]) } },
  { rule: 'quickPicks', error: E.quickPicks, alone: { quickPicks: '10.5' }, stacked: { quickPicks: '10.5,6000' } },
  { rule: 'quickPicksRange', error: E.quickPicksRange, alone: { quickPicks: '10,6000' } },
  { rule: 'number', error: E.number, alone: { paperPrice: '800.5' } },
  { rule: 'schema (zod, last)', error: INVALID, alone: { deliveryFeeIqd: '' } },
];

describe('parseSettingsForm: order of the checks', () => {
  it('each rule on its own gives its own message', () => {
    for (const r of RULES) expect(errorOf(r.alone), r.rule).toBe(r.error);
  });

  it('when a rule and every later rule are broken together, the earlier one decides the message', () => {
    RULES.forEach((r, i) => {
      // Later rules first, so that the earliest rule's value wins for a field they share.
      const laterFirst = RULES.slice(i).reverse();
      const overrides: Overrides = Object.assign({}, ...laterFirst.map((x) => x.stacked ?? x.alone));
      expect(errorOf(overrides), `${r.rule} and everything after it`).toBe(r.error);
    });
  });
});

describe('parseSettingsForm: each check', () => {
  it('tiers: anything but a JSON array is invalid; a missing or empty field means no tiers', () => {
    expect(errorOf({ tiers: '{nope' })).toBe(INVALID);
    expect(errorOf({ tiers: '{"minSheets":20}' })).toBe(INVALID);
    expect(errorOf({ tiers: '"20"' })).toBe(INVALID);
    expect(settingsOf({ tiers: null }).pricing.tiers).toEqual([]);
    expect(settingsOf({ tiers: '' }).pricing.tiers).toEqual([]);
    expect(settingsOf({ tiers: '[]' }).pricing.tiers).toEqual([]);
  });

  it('noMaterial: only when both materials are off; any value but "on" counts as off', () => {
    expect(errorOf({ paperEnabled: null, plasticEnabled: null })).toBe(E.noMaterial);
    expect(errorOf({ paperEnabled: 'true', plasticEnabled: '1' })).toBe(E.noMaterial);
    expect(settingsOf({ plasticEnabled: null }).pricing.materials.plastic.enabled).toBe(false);
    expect(settingsOf({ paperEnabled: null }).pricing.materials.paper.enabled).toBe(false);
  });

  it('minMax: minimum above maximum; equal is fine', () => {
    expect(errorOf({ minSheets: '300', maxSheets: '200' })).toBe(E.minMax);
    expect(errorOf({ minSheets: '50', maxSheets: '50', quickPicks: '50' })).toBeNull();
  });

  it('tiersMax: 21 tiers are too many, 20 are fine', () => {
    const rows = (n: number) => tiersJson(Array.from({ length: n }, (_, i): TierCells => [String(i + 20), '1']));
    expect(errorOf({ tiers: rows(21) })).toBe(E.tiersMax);
    expect(settingsOf({ tiers: rows(20) }).pricing.tiers).toHaveLength(20);
  });

  it('duplicateTier: two tiers with the same minSheets, also when both are blank', () => {
    expect(errorOf({ tiers: tiersJson([['20', '10'], ['20', '15']]) })).toBe(E.duplicateTier);
    expect(errorOf({ tiers: tiersJson([['', '5'], ['', '10']]) })).toBe(E.duplicateTier);
  });

  it('tierPercent: only for whole percents outside 0-90', () => {
    const percent = (p: string) => errorOf({ tiers: tiersJson([['20', p]]) });
    expect(percent('91')).toBe(E.tierPercent);
    expect(percent('-1')).toBe(E.tierPercent);
    expect(percent('0')).toBeNull();
    expect(percent('90')).toBeNull();
    // Not whole numbers: the percent rule skips them and the number rule reports them.
    expect(percent('12.5')).toBe(E.number);
    expect(percent('95.5')).toBe(E.number);
    expect(percent('-0.5')).toBe(E.number);
    expect(percent('')).toBe(E.number);
  });

  it('quickPicks: at most 8 whole numbers from 1 up', () => {
    expect(errorOf({ quickPicks: '10,11,12,13,14,15,16,17,18' })).toBe(E.quickPicks);
    expect(errorOf({ quickPicks: '10,abc' })).toBe(E.quickPicks);
    expect(errorOf({ quickPicks: '10.5' })).toBe(E.quickPicks);
    expect(errorOf({ quickPicks: '0' })).toBe(E.quickPicks);
    expect(errorOf({ quickPicks: '-10' })).toBe(E.quickPicks);
    expect(settingsOf({ quickPicks: '10,11,12,13,14,15,16,17' }).pricing.quickPicks).toHaveLength(8);
    expect(settingsOf({ quickPicks: '' }).pricing.quickPicks).toEqual([]);
    expect(settingsOf({ quickPicks: '10,10,20' }).pricing.quickPicks).toEqual([10, 10, 20]);
  });

  it('quickPicksRange: every quick pick must lie between the minimum and the maximum', () => {
    expect(errorOf({ quickPicks: '5,10' })).toBe(E.quickPicksRange);
    expect(errorOf({ quickPicks: '10,6000' })).toBe(E.quickPicksRange);
    expect(errorOf({ quickPicks: '10,5000' })).toBeNull();
  });

  it('number: prices, sheet limits and tier cells must be whole numbers', () => {
    expect(errorOf({ paperPrice: '' })).toBe(E.number);
    expect(errorOf({ paperPrice: '800.5' })).toBe(E.number);
    expect(errorOf({ paperPrice: '٨٠٠' })).toBe(E.number);
    expect(errorOf({ plasticPrice: 'abc' })).toBe(E.number);
    expect(errorOf({ minSheets: '' })).toBe(E.number);
    expect(errorOf({ maxSheets: '' })).toBe(E.number);
    expect(errorOf({ tiers: tiersJson([['', '']]) })).toBe(E.number);
    expect(errorOf({ tiers: '[null]' })).toBe(E.number);
  });

  it('schema: what only zod catches is reported as invalid', () => {
    expect(errorOf({ deliveryFeeIqd: '' })).toBe(INVALID);
    expect(errorOf({ deliveryFeeIqd: '5000.5' })).toBe(INVALID);
    expect(errorOf({ retentionDays: '' })).toBe(INVALID);
    expect(errorOf({ retentionDays: null })).toBe(INVALID);
    expect(errorOf({ retentionDays: '0' })).toBe(INVALID);
    expect(errorOf({ shopName: '   ' })).toBe(INVALID);
    expect(errorOf({ whatsapp: '1234567890123456' })).toBe(INVALID);
    expect(errorOf({ paperPrice: '-800' })).toBe(INVALID);
    expect(errorOf({ tiers: tiersJson([['0', '5']]) })).toBe(INVALID);
  });

  it('layout millimetres: blank, not a number, negative or too large is invalid', () => {
    for (const name of ['margin', 'circleGapX', 'circleGapY', 'roundedGap', 'sharpGap', 'customGap', 'roundedRadius']) {
      expect(errorOf({ [name]: '' }), `${name} blank`).toBe(INVALID);
      expect(errorOf({ [name]: 'abc' }), `${name} abc`).toBe(INVALID);
      expect(errorOf({ [name]: '-1' }), `${name} -1`).toBe(INVALID);
      expect(errorOf({ [name]: '101' }), `${name} 101`).toBe(INVALID);
    }
  });
});

describe('parseSettingsForm: accepted form', () => {
  it('the form as rendered for the stored settings gives back the stored settings', () => {
    expect(parse()).toEqual({ ok: true, settings: CURRENT });
  });

  it('whatsapp is stripped to digits and text fields are trimmed', () => {
    const s = settingsOf({ whatsapp: '+964 770 999-9999', shopName: '  New name  ', telegramChatId: ' -100999 ' });
    expect(s.whatsapp).toBe('9647709999999');
    expect(s.shopName).toBe('New name');
    expect(s.telegramChatId).toBe('-100999');
  });

  it('millimetres become whole micrometres, each field in its own key', () => {
    const s = settingsOf({
      margin: '7.5',
      circleGapX: '1.25',
      circleGapY: '0.5',
      roundedGap: '3',
      sharpGap: '1',
      customGap: '0',
      roundedRadius: '2.3',
      allowRotate: 'on',
    });
    expect(s.layout).toEqual({
      marginUm: 7_500,
      circleGapXUm: 1_250,
      circleGapYUm: 500,
      rectRoundedGapUm: 3_000,
      rectSharpGapUm: 1_000,
      customGapUm: 0,
      roundedRadiusUm: 2_300,
      allowRotate: true,
      minSideUm: 6_000,
    });
    expect(settingsOf({ circleGapX: '2.0004' }).layout.circleGapXUm).toBe(2_000);
  });

  it('quick picks accept the Arabic comma and spaces; tiers come back sorted', () => {
    const s = settingsOf({
      minSheets: '5',
      maxSheets: '200',
      quickPicks: ' 5، 10 ,50  200 ',
      tiers: tiersJson([['100', '25'], ['10', '5'], [50, 15]]),
    });
    expect(s.pricing.quickPicks).toEqual([5, 10, 50, 200]);
    expect(s.pricing.tiers).toEqual([
      { minSheets: 10, percent: 5 },
      { minSheets: 50, percent: 15 },
      { minSheets: 100, percent: 25 },
    ]);
  });

  it('what the form does not carry is kept from the stored settings', () => {
    const s = settingsOf({ shopName: 'Other', margin: '9', paperPrice: '1000', pricesPublished: null });
    expect(s.quality).toEqual(CURRENT.quality);
    expect(s.maxUploadBytes).toBe(CURRENT.maxUploadBytes);
    expect(s.layout.minSideUm).toBe(CURRENT.layout.minSideUm);
    expect(s.pricesPublished).toBe(false);
  });

  it('does not change the stored settings object it was given', () => {
    const before = structuredClone(CURRENT);
    parse({ shopName: 'Other', margin: '9', tiers: '[]', quickPicks: '' });
    parse({ paperPrice: 'x' });
    expect(CURRENT).toEqual(before);
  });
});
