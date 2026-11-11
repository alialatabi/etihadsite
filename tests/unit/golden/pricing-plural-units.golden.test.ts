/**
 * GOLDEN — pricing.ts, plural.ts, units.ts, display-no.ts, parse/cm.ts, parse/phone.ts.
 * Pure functions over wide input tables; one line per case.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DISPLAY_NO_ALPHABET, SHOP_TIME_ZONE } from '@/config/defaults';
import { common } from '@/content/ar';
import { makeDisplayNo, pdfFileNameFor } from '@/lib/display-no';
import { formatCm, normaliseDigits, parseCm } from '@/lib/parse/cm';
import { formatPhoneLocal, normalisePhone, whatsappUrl } from '@/lib/parse/phone';
import { count, countLabel, type PluralForms } from '@/lib/plural';
import { discountFor, enabledMaterials, formatIqd, priceFor, unitPriceFor, validateQuantity } from '@/lib/pricing';
import type { DiscountTier, Material, PricingSettings, ShopSettings } from '@/lib/types';
import * as units from '@/lib/units';
import { show, visible } from './_util';

const MATERIALS: Material[] = ['paper', 'plastic'];
const SHEETS = [-5, 0, 1, 9, 10, 11, 19, 20, 21, 49, 50, 51, 99, 100, 101, 500, 4_999, 5_000, 5_001, 100_000, 1_000_000_000, 10.5];
const COUNTS_PER_SHEET = [0, 1, 6, 54];

function priceLine(material: Material, sheets: number, cps: number, settings: ShopSettings): string {
  const p = priceFor(material, sheets, cps, settings);
  return (
    `${material} sheets=${sheets} perSheet=${cps} -> base=${show(p.unitBaseIqd)} disc=${p.discountPercent}% unit=${show(p.unitPriceIqd)}` +
    ` subtotal=${show(p.subtotalIqd)} delivery=${p.deliveryFeeIqd} total=${show(p.totalIqd)} stickers=${p.totalStickers} perSticker=${show(p.perStickerIqd)}` +
    ` [material=${p.material} sheets=${p.sheets}]`
  );
}

function priceTable(settings: ShopSettings): string[] {
  const rows: string[] = [];
  for (const material of MATERIALS) for (const sheets of SHEETS) for (const cps of COUNTS_PER_SHEET) rows.push(priceLine(material, sheets, cps, settings));
  return rows;
}

const ALT_SETTINGS: ShopSettings = {
  ...DEFAULT_SETTINGS,
  deliveryFeeIqd: 0,
  pricing: {
    materials: { paper: { enabled: false, pricePerSheetIqd: 1_333 }, plastic: { enabled: true, pricePerSheetIqd: 2_750 } },
    minSheets: 1,
    maxSheets: 300,
    // Deliberately unsorted, with a 0% tier and a tier that lowers the discount.
    tiers: [
      { minSheets: 100, percent: 33 },
      { minSheets: 5, percent: 7 },
      { minSheets: 50, percent: 0 },
      { minSheets: 20, percent: 15 },
      { minSheets: 1_000, percent: 90 },
    ],
    quickPicks: [1, 5, 20],
  },
};

describe('golden: priceFor', () => {
  it('default settings, prices published', () => {
    expect(priceTable(DEFAULT_SETTINGS)).toMatchSnapshot();
  });
  it('default settings, prices NOT published', () => {
    expect(priceTable({ ...DEFAULT_SETTINGS, pricesPublished: false })).toMatchSnapshot();
  });
  it('alternative settings (odd prices, unsorted tiers, no delivery fee), published', () => {
    expect(priceTable(ALT_SETTINGS)).toMatchSnapshot();
  });
  it('alternative settings, NOT published', () => {
    expect(priceTable({ ...ALT_SETTINGS, pricesPublished: false })).toMatchSnapshot();
  });
  it('full PriceBreakdown objects (key set) for one priced and one unpriced case', () => {
    expect({
      priced: priceFor('plastic', 50, 54, DEFAULT_SETTINGS),
      unpriced: priceFor('paper', 20, 6, { ...DEFAULT_SETTINGS, pricesPublished: false }),
      noTiers: priceFor('paper', 100, 54, { ...DEFAULT_SETTINGS, pricing: { ...DEFAULT_SETTINGS.pricing, tiers: [] } }),
    }).toMatchSnapshot();
  });
});

describe('golden: discountFor / unitPriceFor', () => {
  const TIER_SETS: Record<string, DiscountTier[]> = {
    default: DEFAULT_SETTINGS.pricing.tiers,
    alt: ALT_SETTINGS.pricing.tiers,
    empty: [],
    single: [{ minSheets: 10, percent: 5 }],
    duplicateMin: [
      { minSheets: 10, percent: 5 },
      { minSheets: 10, percent: 50 },
    ],
    descending: [
      { minSheets: 100, percent: 20 },
      { minSheets: 50, percent: 15 },
      { minSheets: 20, percent: 10 },
    ],
    zeroMin: [{ minSheets: 0, percent: 3 }],
  };
  it('discountFor: sheets x tier sets', () => {
    const rows = Object.entries(TIER_SETS).map(
      ([name, tiers]) => `${name} | ${[...SHEETS, Number.NaN].map((s) => `${s}=>${discountFor(s, tiers)}`).join(' ')}`,
    );
    expect(rows).toMatchSnapshot();
  });
  it('unitPriceFor: bases x percents (rounding)', () => {
    const bases = [0, 1, 10, 30, 333, 800, 1_333, 1_500, 2_750, 9_999, 100_000_000, -800, 12.5];
    const percents = [0, 1, 5, 7, 10, 15, 20, 33, 50, 90, 100, 150, -10, 12.5];
    expect(bases.map((b) => `base=${b} | ${percents.map((p) => `${p}%=>${show(unitPriceFor(b, p))}`).join(' ')}`)).toMatchSnapshot();
  });
});

describe('golden: validateQuantity / enabledMaterials', () => {
  const mk = (paper: boolean, plastic: boolean, over: Partial<PricingSettings> = {}): PricingSettings => ({
    ...DEFAULT_SETTINGS.pricing,
    materials: {
      paper: { enabled: paper, pricePerSheetIqd: 800 },
      plastic: { enabled: plastic, pricePerSheetIqd: 1_500 },
    },
    ...over,
  });
  const PRICINGS: Record<string, PricingSettings> = {
    default: DEFAULT_SETTINGS.pricing,
    paperOnly: mk(true, false),
    plasticOnly: mk(false, true),
    noneEnabled: mk(false, false),
    'min1-max1': mk(true, true, { minSheets: 1, maxSheets: 1 }),
    'min50-max40 (inverted)': mk(true, true, { minSheets: 50, maxSheets: 40 }),
  };
  it('validateQuantity table', () => {
    const sheets = [...SHEETS, 1, 40, 45, Number.NaN, Number.POSITIVE_INFINITY, -0, 20.000000001];
    const rows: string[] = [];
    for (const [name, pricing] of Object.entries(PRICINGS)) {
      for (const m of [...MATERIALS, 'gold' as Material]) {
        rows.push(`${name} | ${m} | ${sheets.map((s) => `${show(s)}=>${validateQuantity(m, s, pricing) ?? 'ok'}`).join(' ')}`);
      }
    }
    expect(rows).toMatchSnapshot();
  });
  it('enabledMaterials table', () => {
    expect(Object.entries(PRICINGS).map(([name, pricing]) => `${name} -> [${enabledMaterials(pricing).join(', ')}]`)).toMatchSnapshot();
  });
});

describe('golden: formatIqd', () => {
  it('table (Intl ar-IQ-u-nu-latn; invisible marks shown as <U+XXXX>)', () => {
    const values = [
      0, 1, 12, 999, 1_000, 5_000, 14_400, 25_000, 68_750, 100_000, 999_999, 1_234_567, 1_000_000_000, 123_456_789_012, -1, -5_000,
      1_234.4, 1_234.5, 1_235.5, 0.4, 0.5, -0.4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    ];
    expect(values.map((v) => `${show(v)} -> ${visible(formatIqd(v))}`)).toMatchSnapshot();
  });
});

describe('golden: plural', () => {
  const NS = [...Array.from({ length: 121 }, (_, i) => i), 199, 200, 201, 202, 203, 210, 211, 299, 300, 1_000, 1_001, 1_002, 1_003, 1_011, 1_100, 1_000_000, 1.5, 2.5, -1, -2, -3, -11];
  for (const [name, forms] of Object.entries(common.plural) as [string, PluralForms][]) {
    it(`countLabel for common.plural.${name}`, () => {
      expect(NS.map((n) => countLabel(n, forms))).toMatchSnapshot();
    });
  }
  it('count() returns the bare form and which CLDR category each n selects', () => {
    const probe: PluralForms = { zero: 'zero', one: 'one', two: 'two', few: 'few', many: 'many', other: 'other' };
    // Run-length encoded: "0:zero 1:one 2:two 3-10:few 11-99:many …"
    const runs: string[] = [];
    let start = 0;
    let prev = count(0, probe);
    for (let n = 1; n <= 1_250; n++) {
      const cur = count(n, probe);
      if (cur !== prev) {
        runs.push(start === n - 1 ? `${start}:${prev}` : `${start}-${n - 1}:${prev}`);
        start = n;
        prev = cur;
      }
    }
    runs.push(`${start}-1250:${prev}`);
    expect({ runs, fractions: [0.5, 1.5, 2.5, 10.1, 100.5].map((n) => `${n}:${count(n, probe)}`), negatives: [-1, -2, -3, -11, -100].map((n) => `${n}:${count(n, probe)}`) }).toMatchSnapshot();
  });
  it('plural keys present in common.plural', () => {
    expect(Object.keys(common.plural)).toMatchSnapshot();
  });
});

describe('golden: units', () => {
  it('constants', () => {
    expect({
      UM_PER_MM: units.UM_PER_MM,
      UM_PER_CM: units.UM_PER_CM,
      UM_PER_INCH: units.UM_PER_INCH,
      PT_PER_INCH: units.PT_PER_INCH,
      A4_UM: units.A4_UM,
      A4_PT: units.A4_PT,
      exports: Object.keys(units).sort(),
    }).toMatchSnapshot();
  });
  it('conversions', () => {
    const lengths = [0, 0.1, 0.5, 1, 2.3, 2.35, 3, 4.24, 4.2425, 5, 7.05, 10, 19.6, 21, 29.7, 100, -1, 1e-5, Number.NaN];
    const ums = [0, 1, 499, 500, 1_000, 5_000, 23_000, 25_400, 30_000, 42_420, 196_000, 210_000, 283_000, 297_000, -25_400, 0.5];
    const pts = [0, 1, 72, 100, 200, 300, 400, 595.2756, 595.275590551181, 841.8898, 0.001, -72];
    expect({
      mmToUm: lengths.map((v) => `${show(v)}=>${show(units.mmToUm(v))}`).join(' '),
      cmToUm: lengths.map((v) => `${show(v)}=>${show(units.cmToUm(v))}`).join(' '),
      umToMm: ums.map((v) => `${v}=>${units.umToMm(v)}`).join(' '),
      umToCm: ums.map((v) => `${v}=>${units.umToCm(v)}`).join(' '),
      umToPt: ums.map((v) => `${v}=>${units.umToPt(v)}`).join(' '),
      umToInch: ums.map((v) => `${v}=>${units.umToInch(v)}`).join(' '),
      ptToUm: pts.map((v) => `${v}=>${units.ptToUm(v)}`).join(' '),
    }).toMatchSnapshot();
  });
  it('pxForUmAtDpi / effectiveDpi', () => {
    const ums = [0, 1, 5_000, 20_000, 25_400, 30_000, 40_000, 50_000, 76_200, 196_000, 254_000, -25_400];
    const dpis = [72, 96, 150, 300, 600];
    const pxs = [0, 1, 100, 300, 354, 400, 719, 720, 900, 1_800, 4_000];
    expect({
      pxForUmAtDpi: ums.map((um) => `${um}um | ${dpis.map((d) => `${d}dpi=>${units.pxForUmAtDpi(um, d)}`).join(' ')}`),
      effectiveDpi: pxs.map((px) => `${px}px | ${ums.map((um) => `${um}=>${units.effectiveDpi(px, um)}`).join(' ')}`),
    }).toMatchSnapshot();
  });
});

describe('golden: display numbers and PDF file names', () => {
  it('constants', () => {
    expect({ DISPLAY_NO_ALPHABET, SHOP_TIME_ZONE }).toMatchSnapshot();
  });
  it('makeDisplayNo with fixed dates and deterministic rand', () => {
    const dates = [
      '2025-11-07T10:00:00.000Z',
      '2026-11-09T20:59:59.999Z', // 23:59 Baghdad
      '2026-11-09T21:00:00.000Z', // 00:00 Baghdad next day
      '2026-12-31T20:59:59.000Z',
      '2026-12-31T21:00:00.000Z', // new year in Baghdad
      '2027-01-05T00:00:00.000Z',
      '2028-02-29T12:00:00.000Z',
      '2099-06-01T00:00:00.000Z',
      '1999-12-31T23:00:00.000Z',
    ];
    const rands: Record<string, () => (max: number) => number> = {
      zero: () => () => 0,
      last: () => (max) => max - 1,
      counter: () => {
        let i = 0;
        return (max) => i++ % max;
      },
      step7: () => {
        let i = 3;
        return (max) => (i += 7) % max;
      },
    };
    const rows: string[] = [];
    for (const iso of dates) {
      for (const [name, make] of Object.entries(rands)) rows.push(`${iso} rand=${name} -> ${makeDisplayNo(new Date(iso), make())}`);
    }
    const maxSeen: number[] = [];
    makeDisplayNo(new Date(dates[0]), (max) => {
      maxSeen.push(max);
      return 0;
    });
    expect({ rows, randCalledWith: maxSeen }).toMatchSnapshot();
  });
  it('makeDisplayNo with default args has the documented shape (value itself is random)', () => {
    expect(makeDisplayNo()).toMatch(/^EP-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  });
  it('pdfFileNameFor samples', () => {
    const specs: { shape: 'circle' | 'rect' | 'custom'; widthUm: number; heightUm: number }[] = [
      { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
      { shape: 'rect', widthUm: 50_000, heightUm: 30_000 },
      { shape: 'rect', widthUm: 42_420, heightUm: 30_000 },
      { shape: 'custom', widthUm: 12_345, heightUm: 6_789 },
      { shape: 'custom', widthUm: 12_355, heightUm: 5 },
      { shape: 'rect', widthUm: 196_000, heightUm: 283_000 },
      { shape: 'circle', widthUm: 1, heightUm: 1 },
      { shape: 'rect', widthUm: 0, heightUm: -1_500 },
    ];
    const rows: string[] = [];
    for (const displayNo of ['EP-251107-AB3C', 'EP-261110-ZZZZ', '']) {
      for (const spec of specs) for (const sheets of [1, 20, 5_000]) rows.push(pdfFileNameFor(displayNo, spec, sheets));
    }
    expect(rows).toMatchSnapshot();
  });
});

describe('golden: parse/cm', () => {
  it('parseCm table', () => {
    const inputs = [
      '3', '3.5', '3,5', '٣٫٢٥', '۳٫۲۵', ' 4 ', '4 سم', '4سم', '4 cm', '4CM', '4 Cm ', '4 mm', '.5', '5.', '0', '0.0', '00.5', '0.00001', '0.00005',
      '0.00004', '-3', '+3', '3e2', '1,234.5', '1.2.3', 'abc', '', '   ', '٤', '۴', '٤,٢٤', '4.2425', '2.3', '19.6', '29.7', '1000000', '99999999999999999999',
      '3 ٫ 5', '٣ سم', 'سم', '3 cm', '3\tcm',
    ];
    expect(inputs.map((s) => `${show(s)} -> ${show(parseCm(s))}`)).toMatchSnapshot();
  });
  it('parseCm non-string input', () => {
    const f = parseCm as (v: unknown) => number | null;
    expect([f(3), f(null), f(undefined), f({}), f(['3'])]).toMatchSnapshot();
  });
  it('formatCm table', () => {
    const ums = [0, 1, 49, 50, 99, 100, 149, 150, 4_999, 5_000, 23_000, 30_000, 42_420, 42_450, 42_449, 196_000, 283_000, 12_345.6, -30_000, Number.NaN, Number.POSITIVE_INFINITY];
    expect(ums.map((um) => `${show(um)} -> ${show(formatCm(um))}`)).toMatchSnapshot();
  });
  it('normaliseDigits table', () => {
    const inputs = ['٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹', '0770 ١٢٣ ۴۵۶۷', 'abc', '', '٣٫٢٥ سم', '１２３'];
    expect(inputs.map((s) => `${show(s)} -> ${show(normaliseDigits(s))}`)).toMatchSnapshot();
  });
});

describe('golden: parse/phone', () => {
  const PHONES = [
    '07701234567', '7701234567', '+9647701234567', '009647701234567', '9647701234567', '964 770 123 4567', '+964 (770) 123-4567', '0770-123-4567',
    '0770 123 4567', '٠٧٧٠١٢٣٤٥٦٧', '۰۷۷۰۱۲۳۴۵۶۷', '+٩٦٤٧٧٠١٢٣٤٥٦٧', '07801234567', '07501234567', '07901234567', '07001234567', '0770123456',
    '077012345678', '06701234567', '08701234567', '17701234567', '96407701234567', '0096407701234567', '009647701234567 ', '00 964 7701234567',
    '9640770123456', '964964770123456', '0 0 7 7 0 1 2 3 4 5 6 7', '007701234567', 'tel:07701234567', '07701234567 ext 5', 'abc', '', '   ', '+', '0', '964',
    '7', '770123456７',
  ];
  it('normalisePhone table', () => {
    expect(PHONES.map((p) => `${show(p)} -> ${show(normalisePhone(p))}`)).toMatchSnapshot();
  });
  it('normalisePhone non-string input', () => {
    const f = normalisePhone as (v: unknown) => string | null;
    expect([f(7701234567), f(null), f(undefined), f({})]).toMatchSnapshot();
  });
  it('formatPhoneLocal table', () => {
    const inputs = ['9647701234567', '9647801112222', '9646701234567', '964770123456', '96477012345678', '07701234567', '', 'abc'];
    expect(inputs.map((p) => `${show(p)} -> ${show(formatPhoneLocal(p))}`)).toMatchSnapshot();
  });
  it('whatsappUrl table', () => {
    expect([
      whatsappUrl('9647701234567'),
      whatsappUrl('9647701234567', ''),
      whatsappUrl('9647701234567', 'hello world'),
      whatsappUrl('9647701234567', 'مرحباً، عندي طلب ستيكرات:\nالشكل: دائري\n3 × 3 سم & 100% #1 ?x=y+z'),
      whatsappUrl('', 'x'),
    ]).toMatchSnapshot();
  });
});
