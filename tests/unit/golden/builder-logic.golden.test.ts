/**
 * GOLDEN — src/components/builder/logic.ts, safe.ts, degraded.ts and shell/whatsapp.ts,
 * with the REAL sibling modules (no mocks). The fallback branches of safe.ts/degraded.ts
 * (taken only when a sibling throws) are pinned in builder-fallbacks.golden.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { degradedText, degradedUrl, manualSummaryText } from '@/components/builder/degraded';
import {
  EMPTY_FIELDS,
  FORM_KEY,
  STEPS,
  SUCCESS_KEY,
  activeTier,
  buildSummary,
  clampSheets,
  clearForm,
  dpiExact,
  dpiFor,
  dpiStatus,
  loadForm,
  loadSuccess,
  needsCropNotice,
  nextTierNudge,
  parseSheets,
  pdfPrefillUm,
  quickPicksFor,
  saveForm,
  saveSuccess,
  sortedTiers,
  validateCustomer,
  type FormFields,
  type PersistedForm,
  type SummaryData,
} from '@/components/builder/logic';
import {
  safeCountLabel,
  safeDerive,
  safeFormatCm,
  safeLayout,
  safeMaxWidth,
  safeParseCm,
  safePrice,
  safeShapeLabel,
  safeSizeLabel,
} from '@/components/builder/safe';
import { whatsappHref } from '@/components/shell/whatsapp';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { computeLayout, layoutParamsFor } from '@/lib/layout';
import { priceFor } from '@/lib/pricing';
import type { DesignSource, DiscountTier, OrderResponse, QualitySettings, Shape, StickerSpec } from '@/lib/types';
import { canon, sha16, show, visible } from './_util';

const design = (over: Partial<DesignSource> = {}): DesignSource => ({
  kind: 'png',
  file: new File([], 'a.png'),
  pxWidth: 900,
  pxHeight: 900,
  hasAlpha: false,
  previewUrl: 'blob:x',
  ...over,
});
const spec = (shape: Shape, widthUm: number, heightUm = widthUm): StickerSpec => ({ shape, widthUm, heightUm });

describe('golden: constants', () => {
  it('STEPS, keys, EMPTY_FIELDS', () => {
    expect({ STEPS, FORM_KEY, SUCCESS_KEY, EMPTY_FIELDS }).toMatchSnapshot();
  });
});

describe('golden: validateCustomer', () => {
  const ok: FormFields = { name: 'علي', phone: '07701234567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر', notes: '' };
  const PHONES = [
    '07701234567', '7701234567', '+9647701234567', '9647701234567', '009647701234567', '٠٧٧٠١٢٣٤٥٦٧', '۰۷۷۰۱۲۳۴۵۶۷', '+٩٦٤ ٧٧٠ ١٢٣ ٤٥٦٧', '0770 123 4567',
    '0770-123-4567', '+964 (770) 123-4567', ' 07701234567 ', '07801234567', '07501112222', '07901112222', '0770123456', '077012345678', '06701234567',
    '08001234567', '17701234567', '96407701234567', '0096407701234567', '+9640770123456', '00447701234567', '+17701234567', '12345', 'abc', '', '   ', '0',
    '964', '+', '07701234567x', 'ext.07701234567',
  ];
  it('phone formats', () => {
    expect(
      PHONES.map((phone) => {
        const r = validateCustomer({ ...ok, phone });
        return `${show(phone)} -> phoneE164=${show(r.phoneE164)} errors=${canon(r.errors)}`;
      }),
    ).toMatchSnapshot();
  });
  it('missing / blank fields', () => {
    const cases: [string, Partial<FormFields>][] = [
      ['all valid', {}],
      ['name empty (optional)', { name: '' }],
      ['notes filled', { notes: 'x' }],
      ['governorate empty', { governorate: '' }],
      ['governorate whitespace (not trimmed)', { governorate: '  ' }],
      ['governorate not in the list', { governorate: 'Atlantis' }],
      ['district empty', { district: '' }],
      ['district whitespace', { district: ' \t ' }],
      ['landmark empty', { landmark: '' }],
      ['landmark whitespace', { landmark: '\n' }],
      ['everything empty', { name: '', phone: '', governorate: '', district: '', landmark: '', notes: '' }],
      ['only phone bad', { phone: '123' }],
    ];
    expect(cases.map(([label, over]) => `${label} -> ${canon(validateCustomer({ ...ok, ...over }))}`)).toMatchSnapshot();
  });
  it('EMPTY_FIELDS', () => {
    expect(validateCustomer(EMPTY_FIELDS)).toMatchSnapshot();
  });
});

describe('golden: sheets input', () => {
  it('parseSheets table', () => {
    const inputs = [
      '', ' ', '0', '1', '10', ' 12 ', '007', '١٢', '۱۲', '١۲3', '12.5', '12.0', '١٢.٥', '١٢٫٥', '12,5', '-3', '-0', '+5', '5.', '.5', '1e2', '0x10',
      'Infinity', 'NaN', 'abc', '12abc', '1 000', '1,000', '5000', '99999999999999999999', '１２', '12\n',
    ];
    expect(inputs.map((s) => `${show(s)} -> ${show(parseSheets(s))}`)).toMatchSnapshot();
  });
  it('clampSheets table', () => {
    const ns = [-10, 0, 1, 9, 9.4, 9.5, 10, 10.4, 10.5, 11, 4_999.5, 5_000, 5_000.4, 5_001, 1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const ranges = [
      { minSheets: 10, maxSheets: 5_000 },
      { minSheets: 1, maxSheets: 1 },
      { minSheets: 50, maxSheets: 40 },
    ];
    expect(ranges.map((r) => `${r.minSheets}..${r.maxSheets} | ${ns.map((n) => `${show(n)}=>${clampSheets(n, r)}`).join(' ')}`)).toMatchSnapshot();
  });
  it('quickPicksFor table', () => {
    const cases = [
      DEFAULT_SETTINGS.pricing,
      { minSheets: 10, maxSheets: 5_000, quickPicks: [100, 20, 20, 5, 10, 5_001, 5_000, 12.5, 50] },
      { minSheets: 1, maxSheets: 30, quickPicks: [10, 20, 50, 100] },
      { minSheets: 200, maxSheets: 5_000, quickPicks: [10, 20, 50, 100] },
      { minSheets: 10, maxSheets: 5_000, quickPicks: [] },
      { minSheets: 10, maxSheets: 5_000, quickPicks: [Number.NaN, -10, 0, 10] },
    ];
    expect(cases.map((c) => `${c.minSheets}..${c.maxSheets} [${c.quickPicks.join(',')}] -> [${quickPicksFor(c).join(',')}]`)).toMatchSnapshot();
  });
});

describe('golden: discount tiers', () => {
  const TIER_SETS: Record<string, DiscountTier[]> = {
    default: DEFAULT_SETTINGS.pricing.tiers,
    unsorted: [
      { minSheets: 100, percent: 20 },
      { minSheets: 20, percent: 10 },
      { minSheets: 50, percent: 15 },
    ],
    nonMonotonic: [
      { minSheets: 5, percent: 7 },
      { minSheets: 20, percent: 15 },
      { minSheets: 50, percent: 0 },
      { minSheets: 100, percent: 33 },
      { minSheets: 1_000, percent: 90 },
    ],
    duplicateMin: [
      { minSheets: 10, percent: 5 },
      { minSheets: 10, percent: 50 },
    ],
    empty: [],
  };
  const SHEETS: (number | null)[] = [null, 0, 1, 4, 5, 9, 10, 14, 15, 16, 19, 20, 21, 37, 38, 44, 45, 49, 50, 51, 74, 75, 76, 94, 95, 99, 100, 101, 749, 750, 995, 1_000, 5_000, 12.5, -1];
  const tier = (t: DiscountTier | null) => (t ? `${t.minSheets}@${t.percent}%` : 'none');

  it('sortedTiers (defensive copy)', () => {
    const out: Record<string, string> = {};
    for (const [name, tiers] of Object.entries(TIER_SETS)) {
      const before = canon(tiers);
      const sorted = sortedTiers(tiers);
      out[name] = `${sorted.map(tier).join(' ')} | inputUntouched=${canon(tiers) === before} newArray=${sorted !== tiers}`;
    }
    expect(out).toMatchSnapshot();
  });
  it('activeTier table', () => {
    expect(
      Object.entries(TIER_SETS).map(([name, tiers]) => `${name} | ${SHEETS.map((s) => `${show(s)}=>${tier(activeTier(s, tiers))}`).join(' ')}`),
    ).toMatchSnapshot();
  });
  it('nextTierNudge table', () => {
    expect(
      Object.entries(TIER_SETS).map(
        ([name, tiers]) =>
          `${name} | ${SHEETS.map((s) => {
            const n = nextTierNudge(s, tiers);
            return `${show(s)}=>${n ? `+${n.add}:${n.percent}%` : '-'}`;
          }).join(' ')}`,
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: dpi helpers', () => {
  const DESIGNS: [string, DesignSource][] = [
    ['png 900x900', design()],
    ['png 1800x900', design({ pxWidth: 1_800, pxHeight: 900 })],
    ['png 900x1800', design({ pxWidth: 900, pxHeight: 1_800 })],
    ['jpeg 719x719', design({ kind: 'jpeg', pxWidth: 719, pxHeight: 719 })],
    ['jpeg 400x600', design({ kind: 'jpeg', pxWidth: 400, pxHeight: 600 })],
    ['png 1x1', design({ pxWidth: 1, pxHeight: 1 })],
    ['pdf 595x842', design({ kind: 'pdf', pxWidth: 595, pxHeight: 842 })],
  ];
  const SPECS: StickerSpec[] = [
    spec('rect', 76_200),
    spec('circle', 76_200),
    spec('custom', 76_200, 30_000),
    spec('rect', 254_000),
    spec('circle', 254_000),
    spec('rect', 30_000, 50_000),
    spec('circle', 30_000),
    spec('rect', 25_400),
    spec('rect', 1),
    spec('rect', 0),
    spec('rect', -5),
    spec('rect', Number.NaN),
  ];
  const Q: QualitySettings = DEFAULT_SETTINGS.quality;
  it('dpiExact / dpiFor / dpiStatus(default quality)', () => {
    const rows: string[] = [];
    for (const [dName, d] of DESIGNS) {
      for (const s of SPECS) {
        const exact = dpiExact(d, s);
        const floored = dpiFor(d, s);
        rows.push(`${dName} | ${s.shape} ${show(s.widthUm)}x${show(s.heightUm)} -> exact=${show(exact)} floor=${show(floored)} status=${dpiStatus(floored, Q)}`);
      }
    }
    expect(rows).toMatchSnapshot();
  });
  it('dpiStatus thresholds', () => {
    const dpis: (number | null)[] = [null, 0, 1, 71, 71.999, 72, 72.001, 149, 149.999, 150, 151, 300, 10_000, -1, Number.NaN, Number.POSITIVE_INFINITY];
    const qs: QualitySettings[] = [Q, { warnDpi: 72, blockDpi: 150, targetDpi: 300 }, { warnDpi: 100, blockDpi: 100, targetDpi: 300 }, { warnDpi: 1, blockDpi: 1, targetDpi: 72 }];
    expect(qs.map((q) => `warn=${q.warnDpi} block=${q.blockDpi} | ${dpis.map((d) => `${show(d)}=>${dpiStatus(d, q)}`).join(' ')}`)).toMatchSnapshot();
  });
  it('pdfPrefillUm', () => {
    const pdfs: [string, DesignSource['pdf'] | undefined][] = [
      ['no pdf info', undefined],
      ['A4', { pageCount: 1, pageWidthPt: 595.2756, pageHeightPt: 841.8898 }],
      ['200x100pt', { pageCount: 2, pageWidthPt: 200, pageHeightPt: 100 }],
      ['300x400pt', { pageCount: 1, pageWidthPt: 300, pageHeightPt: 400 }],
      ['85.04x85.04pt', { pageCount: 1, pageWidthPt: 85.04, pageHeightPt: 85.04 }],
      ['zero width', { pageCount: 1, pageWidthPt: 0, pageHeightPt: 100 }],
      ['negative height', { pageCount: 1, pageWidthPt: 100, pageHeightPt: -1 }],
      ['NaN', { pageCount: 1, pageWidthPt: Number.NaN, pageHeightPt: 100 }],
      ['tiny (rounds to 0um)', { pageCount: 1, pageWidthPt: 0.001, pageHeightPt: 0.001 }],
    ];
    const shapes: Shape[] = ['circle', 'rect', 'custom'];
    expect(pdfs.map(([name, pdf]) => `${name} | ${shapes.map((s) => `${s}=>${canon(pdfPrefillUm(design({ kind: 'pdf', pdf }), s))}`).join(' ')}`)).toMatchSnapshot();
  });
  it('needsCropNotice', () => {
    const sizes: [number, number][] = [
      [900, 900],
      [918, 900],
      [919, 900],
      [900, 918],
      [900, 919],
      [882, 900],
      [881, 900],
      [1_800, 900],
      [900, 0],
      [0, 0],
    ];
    const shapes: Shape[] = ['circle', 'rect', 'custom'];
    expect({
      nullDesign: shapes.map((s) => `${s}=>${needsCropNotice(s, null)}`).join(' '),
      rows: sizes.map(([w, h]) => `${w}x${h} | ${shapes.map((s) => `${s}=>${needsCropNotice(s, design({ pxWidth: w, pxHeight: h }))}`).join(' ')}`),
    }).toMatchSnapshot();
  });
});

/** Summaries produced by the REAL pipeline: computeLayout -> priceFor -> buildSummary. */
function pipeline(s: StickerSpec, material: 'paper' | 'plastic', sheets: number, published: boolean): SummaryData | null {
  const settings = { ...DEFAULT_SETTINGS, pricesPublished: published };
  const out = computeLayout(s, layoutParamsFor(s, settings.layout));
  if (!out.ok) return null;
  return buildSummary(s, out.layout, priceFor(material, sheets, out.layout.countPerSheet, settings));
}

const PIPELINE_CASES: [string, StickerSpec, 'paper' | 'plastic', number, boolean][] = [
  ['circle 3cm paper x20', { shape: 'circle', widthUm: 30_000, heightUm: 30_000 }, 'paper', 20, true],
  ['circle 3cm (stray corners) plastic x10', { shape: 'circle', corners: 'sharp', widthUm: 30_000, heightUm: 30_000 }, 'plastic', 10, true],
  ['rect rounded 5x3 plastic x50', { shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 30_000 }, 'plastic', 50, true],
  ['rect sharp 4.24x3 paper x100', { shape: 'rect', corners: 'sharp', widthUm: 42_420, heightUm: 30_000 }, 'paper', 100, true],
  ['rect no corners 10x4 paper x10', { shape: 'rect', widthUm: 100_000, heightUm: 40_000 }, 'paper', 10, true],
  ['custom 5x2.5 (stray corners) paper x20 unpriced', { shape: 'custom', corners: 'rounded', widthUm: 50_000, heightUm: 25_000 }, 'paper', 20, false],
  ['custom 5x2.5 plastic x100 unpriced', { shape: 'custom', widthUm: 50_000, heightUm: 25_000 }, 'plastic', 100, false],
];

describe('golden: buildSummary', () => {
  it('via the real layout + pricing pipeline', () => {
    expect(Object.fromEntries(PIPELINE_CASES.map(([name, s, m, n, pub]) => [name, pipeline(s, m, n, pub)]))).toMatchSnapshot();
  });
  it('key order and undefined corners are part of the shape', () => {
    const s = pipeline({ shape: 'circle', corners: 'sharp', widthUm: 30_000, heightUm: 30_000 }, 'paper', 20, true);
    expect({ keys: Object.keys(s ?? {}), hasCornersKey: s ? 'corners' in s : null, corners: show(s?.corners) }).toMatchSnapshot();
  });
});

describe('golden: degraded / manual WhatsApp text', () => {
  it('manualSummaryText, degradedText, degradedUrl for each pipeline case', () => {
    const out: Record<string, unknown> = {};
    for (const [name, s, m, n, pub] of PIPELINE_CASES) {
      const sum = pipeline(s, m, n, pub);
      if (!sum) throw new Error(`pipeline failed for ${name}`);
      const url = degradedUrl('9647709999999', sum);
      out[name] = {
        manual: visible(manualSummaryText(sum)),
        degraded: visible(degradedText(sum)),
        urlPrefix: url?.slice(0, 40),
        urlDecodesToDegradedText: url ? decodeURIComponent(url.split('?text=')[1] ?? '') === degradedText(sum) : null,
        urlHash: url ? sha16(url) : null,
      };
    }
    expect(out).toMatchSnapshot();
  });
  it('degradedUrl edge cases', () => {
    const sum = pipeline({ shape: 'circle', widthUm: 30_000, heightUm: 30_000 }, 'paper', 20, true);
    expect({
      noWhatsapp: degradedUrl('', sum),
      noSummary: degradedUrl('9647709999999', null),
      full: degradedUrl('9647709999999', sum),
    }).toMatchSnapshot();
  });
  it('manualSummaryText with hand-made values (0% discount, null vs undefined prices)', () => {
    const base: SummaryData = {
      shape: 'rect',
      corners: 'sharp',
      widthUm: 12_345,
      heightUm: 6_789,
      countPerSheet: 1,
      sheets: 1,
      material: 'plastic',
      totalStickers: 1,
      unitPriceIqd: 1_500,
      discountPercent: 0,
      subtotalIqd: 1_500,
      deliveryFeeIqd: 0,
      totalIqd: 1_500,
    };
    expect({
      noDiscount: visible(manualSummaryText(base)),
      discount90: visible(manualSummaryText({ ...base, discountPercent: 90, unitPriceIqd: 150, totalIqd: 150 })),
      unitNullTotalKnown: visible(manualSummaryText({ ...base, unitPriceIqd: null })),
      unitKnownTotalNull: visible(manualSummaryText({ ...base, totalIqd: null })),
    }).toMatchSnapshot();
  });
});

describe('golden: safe.ts wrappers (happy path = same result as the wrapped function)', () => {
  it('samples', () => {
    const L = DEFAULT_SETTINGS.layout;
    const layoutLine = (s: StickerSpec): string => {
      const o = safeLayout(s, L);
      return o.ok ? `ok n=${o.layout.countPerSheet} ${o.layout.cols}x${o.layout.rows} ${sha16(canon(o.layout))}` : `FAIL ${o.reason}`;
    };
    expect({
      safeParseCm: ['3', '٣٫٥', 'abc', '', '0'].map((s) => `${show(s)}=>${show(safeParseCm(s))}`),
      safeFormatCm: [30_000, 42_420, 0, Number.NaN].map((n) => `${show(n)}=>${show(safeFormatCm(n))}`),
      safeLayout: [
        spec('circle', 30_000),
        { shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 30_000 } as StickerSpec,
        spec('custom', 300_000),
        spec('rect', 1_000),
        spec('rect', Number.NaN),
      ].map(layoutLine),
      safeDerive: [
        safeDerive('circle', 2, { widthUm: 30_000 }),
        safeDerive('rect', 1.5, { widthUm: 30_000 }),
        safeDerive('rect', 1.5, { heightUm: 30_000 }),
        safeDerive('custom', Number.NaN, { heightUm: 30_000 }),
        safeDerive('custom', 0.7071, { widthUm: 0 }),
      ],
      safeMaxWidth: [
        safeMaxWidth(1, spec('circle', 1), L),
        safeMaxWidth(1.5, { shape: 'rect', corners: 'rounded', widthUm: 1, heightUm: 1 }, L),
        safeMaxWidth(0.5, { shape: 'rect', corners: 'sharp', widthUm: 1, heightUm: 1 }, L),
        safeMaxWidth(60, spec('custom', 1), L),
        safeMaxWidth(Number.NaN, spec('custom', 1), L),
        safeMaxWidth(2, spec('custom', 1), { ...L, allowRotate: true }),
      ],
      safeCountLabel: [0, 1, 2, 3, 11, 54, 100, 1_080].map((n) => safeCountLabel(n)),
      safePrice: [safePrice('paper', 20, 54, DEFAULT_SETTINGS), safePrice('plastic', 50, 6, { ...DEFAULT_SETTINGS, pricesPublished: false })],
      safeShapeLabel: [safeShapeLabel('circle'), safeShapeLabel('rect'), safeShapeLabel('rect', 'rounded'), safeShapeLabel('rect', 'sharp'), safeShapeLabel('custom')],
      safeSizeLabel: [safeSizeLabel(30_000, 30_000), safeSizeLabel(42_420, 30_000)],
    }).toMatchSnapshot();
  });
});

describe('golden: whatsappHref (shell)', () => {
  it('table', () => {
    const inputs = ['9647701234567', '+964 770 123 4567', '07701234567', '1234567', '12345678', '', 'abc', 'wa.me/9647701234567', '٠٧٧٠١٢٣٤٥٦٧'];
    expect(inputs.map((s) => `${show(s)} -> ${show(whatsappHref(s))}`)).toMatchSnapshot();
  });
});

describe('golden: sessionStorage persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  const form: PersistedForm = {
    ...EMPTY_FIELDS,
    name: 'علي',
    phone: '07701234567',
    shape: 'rect',
    corners: 'rounded',
    widthText: '5',
    heightText: '3',
    sizeUm: { widthUm: 50_000, heightUm: 30_000 },
    material: 'paper',
    stickersText: '1080',
  };
  const success: Extract<OrderResponse, { ok: true }> = {
    ok: true,
    orderId: 'order-golden-000000001',
    displayNo: 'EP-251107-AB3C',
    summary: {
      displayNo: 'EP-251107-AB3C',
      shape: 'circle',
      widthUm: 30_000,
      heightUm: 30_000,
      countPerSheet: 54,
      sheets: 20,
      material: 'paper',
      totalStickers: 1_080,
      unitPriceIqd: 720,
      discountPercent: 10,
      subtotalIqd: 14_400,
      deliveryFeeIqd: 5_000,
      totalIqd: 19_400,
    },
    whatsappUrl: '',
    notified: { telegram: 'skipped' },
  };

  it('without a window (server / Node): everything is a silent no-op', () => {
    saveForm(form);
    saveSuccess(success);
    clearForm();
    expect({ loadForm: loadForm(), loadSuccess: loadSuccess() }).toMatchSnapshot();
  });

  it('with a sessionStorage: exact keys and stored JSON, round trip, tolerant loads', () => {
    const data = new Map<string, string>();
    const sessionStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    vi.stubGlobal('window', { sessionStorage });

    saveForm(form);
    saveSuccess(success);
    const stored = Object.fromEntries(data);
    const roundTrip = { form: loadForm(), success: loadSuccess() };
    clearForm();
    const afterClear = { keys: [...data.keys()], form: loadForm() };

    const probe = (key: string, raw: string) => {
      data.set(key, raw);
      return key === FORM_KEY ? loadForm() : loadSuccess();
    };
    const tolerant = {
      formBadJson: probe(FORM_KEY, '{nope'),
      formNull: probe(FORM_KEY, 'null'),
      formNumber: probe(FORM_KEY, '42'),
      formArray: probe(FORM_KEY, '[1,2]'),
      formString: probe(FORM_KEY, '"x"'),
      formPartial: probe(FORM_KEY, '{"shape":"circle","extra":1}'),
      formEmptyString: probe(FORM_KEY, ''),
      successBadJson: probe(SUCCESS_KEY, '{nope'),
      successNotOk: probe(SUCCESS_KEY, '{"ok":false,"error":"x","message":"y"}'),
      successNoDisplayNo: probe(SUCCESS_KEY, '{"ok":true}'),
      successMinimal: probe(SUCCESS_KEY, '{"ok":true,"displayNo":"EP-1"}'),
      successNull: probe(SUCCESS_KEY, 'null'),
    };
    expect({ stored, roundTrip, afterClear, tolerant }).toMatchSnapshot();
  });

  it('a throwing sessionStorage never propagates', () => {
    const boom = () => {
      throw new Error('quota');
    };
    vi.stubGlobal('window', { sessionStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    saveForm(form);
    saveSuccess(success);
    clearForm();
    expect({ loadForm: loadForm(), loadSuccess: loadSuccess() }).toMatchSnapshot();
  });
});
