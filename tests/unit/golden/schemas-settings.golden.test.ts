/**
 * GOLDEN — order-schema.ts, storage/settings-schema.ts, config/defaults.ts and the LOCAL
 * storage adapter (storage/local.ts, storage/paths.ts, storage/index.ts).
 *
 * Every time in here is a fixed INPUT, so nothing is masked except:
 *  - the temp DATA_DIR (never snapshotted; only paths relative to it are),
 *  - the JSON.parse error text logged for an unreadable settings.json (V8 wording) -> <PARSE_ERROR>.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ACCEPTED_EXTENSIONS, ACCEPTED_MIME, DEFAULT_SETTINGS, DISPLAY_NO_ALPHABET, SHOP_TIME_ZONE } from '@/config/defaults';
import { clientLogSchema, orderRequestSchema } from '@/lib/order-schema';
import { getStorage } from '@/lib/storage';
import { LocalStorage, deepMerge } from '@/lib/storage/local';
import { ID_RE, orderJsonPath, pdfPath, uploadMetaPath, uploadPath } from '@/lib/storage/paths';
import { pricingSchema, shopSettingsSchema } from '@/lib/storage/settings-schema';
import type { AnalyticsEvent, OrderRecord, ShopSettings, StoredFileMeta } from '@/lib/types';
import { canon, removeTempDirs, sha256, show, track, visible } from './_util';

const tmp = () => track(mkdtempSync(path.join(tmpdir(), 'ep-golden-store-')));
afterAll(removeTempDirs);

type Parsed = { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; code: string }[] } };

/** "ok <canonical data>" or "REJECT path:code, path:code". */
function verdict(result: Parsed): string {
  if (result.success) return `ok ${visible(canon(result.data))}`;
  return `REJECT ${result.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}:${i.code}`).join(', ')}`;
}

/* ───────────────────────── orderRequestSchema ───────────────────────── */

const validOrder = () => ({
  orderId: 'order-aaaaaaaaaaaaaaaaaa',
  uploadId: 'upload-aaaaaaaaaaaaaaaa',
  spec: { shape: 'circle', widthUm: 30_000, heightUm: 30_000 } as Record<string, unknown>,
  material: 'paper',
  sheets: 20,
  customer: {
    name: 'علي',
    phone: '07701234567',
    governorate: 'بغداد',
    district: 'الكرادة',
    landmark: 'قرب الجسر',
  } as Record<string, unknown>,
});
type OrderBody = ReturnType<typeof validOrder> & Record<string, unknown>;

function orderWith(mutate: (b: OrderBody) => void): OrderBody {
  const b = validOrder() as OrderBody;
  mutate(b);
  return b;
}

const ORDER_CASES: [string, unknown][] = [
  ['valid circle', validOrder()],
  ['valid rect rounded', orderWith((b) => (b.spec = { shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 30_000 }))],
  ['valid rect sharp', orderWith((b) => (b.spec = { shape: 'rect', corners: 'sharp', widthUm: 50_000, heightUm: 30_000 }))],
  ['valid rect without corners', orderWith((b) => (b.spec = { shape: 'rect', widthUm: 50_000, heightUm: 30_000 }))],
  ['valid custom', orderWith((b) => (b.spec = { shape: 'custom', widthUm: 50_000, heightUm: 25_000 }))],
  ['valid circle with corners', orderWith((b) => (b.spec = { shape: 'circle', corners: 'sharp', widthUm: 30_000, heightUm: 30_000 }))],
  ['valid plastic, notes, turnstile token', orderWith((b) => Object.assign(b, { material: 'plastic', turnstileToken: 'tok' }, { customer: { ...b.customer, notes: 'ملاحظة' } }))],
  ['strings are trimmed', orderWith((b) => (b.customer = { name: '  علي  ', phone: ' 0770 123 4567 ', governorate: ' بغداد ', district: '  ', landmark: ' x ', notes: '  ' }))],
  ['unknown keys are stripped (client prices ignored)', orderWith((b) => Object.assign(b, { priceIqd: 1, totalIqd: 1, price: { totalIqd: 1 }, offer: { id: 1 } }, { spec: { ...b.spec, extra: true }, customer: { ...b.customer, vip: true } }))],
  ['no name', orderWith((b) => delete b.customer.name)],
  ['empty name', orderWith((b) => (b.customer.name = ''))],
  ['empty district is allowed', orderWith((b) => (b.customer.district = ''))],
  ['sheets 1 (range checked later against settings)', orderWith((b) => (b.sheets = 1))],
  ['sheets 100000', orderWith((b) => (b.sheets = 100_000))],
  ['width/height 1um', orderWith((b) => (b.spec = { shape: 'rect', widthUm: 1, heightUm: 1 }))],
  ['width/height 400000um', orderWith((b) => (b.spec = { shape: 'rect', widthUm: 400_000, heightUm: 400_000 }))],
  ['ids at 8 and 64 chars', orderWith((b) => Object.assign(b, { orderId: 'a'.repeat(8), uploadId: 'Z_-9'.repeat(16) }))],

  ['not an object: null', null],
  ['not an object: string', 'order'],
  ['not an object: array', []],
  ['empty object', {}],
  ['orderId too short', orderWith((b) => (b.orderId = 'short'))],
  ['orderId 65 chars', orderWith((b) => (b.orderId = 'a'.repeat(65)))],
  ['orderId with slash', orderWith((b) => (b.orderId = '../../etc/passwd'))],
  ['orderId number', orderWith((b) => Object.assign(b, { orderId: 12_345_678 }))],
  ['uploadId missing', orderWith((b) => delete (b as Record<string, unknown>).uploadId)],
  ['uploadId with dot', orderWith((b) => (b.uploadId = 'upload.aaaaaaaaaaaa'))],
  ['spec missing', orderWith((b) => delete (b as Record<string, unknown>).spec)],
  ['spec shape unknown', orderWith((b) => (b.spec.shape = 'hexagon'))],
  ['spec corners unknown', orderWith((b) => (b.spec = { shape: 'rect', corners: 'bevel', widthUm: 1_000, heightUm: 1_000 }))],
  ['spec corners null', orderWith((b) => (b.spec = { shape: 'rect', corners: null, widthUm: 1_000, heightUm: 1_000 }))],
  ['circle not square', orderWith((b) => (b.spec = { shape: 'circle', widthUm: 30_000, heightUm: 30_001 }))],
  ['width 0', orderWith((b) => (b.spec.widthUm = 0))],
  ['width negative', orderWith((b) => (b.spec.widthUm = -30_000))],
  ['width fractional', orderWith((b) => (b.spec.widthUm = 30_000.5))],
  ['width 400001', orderWith((b) => (b.spec.widthUm = 400_001))],
  ['width string', orderWith((b) => (b.spec.widthUm = '30000'))],
  ['height missing', orderWith((b) => delete b.spec.heightUm)],
  ['height NaN (JSON null)', orderWith((b) => (b.spec.heightUm = null))],
  ['material unknown', orderWith((b) => (b.material = 'gold'))],
  ['material missing', orderWith((b) => delete (b as Record<string, unknown>).material)],
  ['sheets 0', orderWith((b) => (b.sheets = 0))],
  ['sheets negative', orderWith((b) => (b.sheets = -5))],
  ['sheets fractional', orderWith((b) => (b.sheets = 10.5))],
  ['sheets 100001', orderWith((b) => (b.sheets = 100_001))],
  ['sheets string', orderWith((b) => Object.assign(b, { sheets: '20' }))],
  ['customer missing', orderWith((b) => delete (b as Record<string, unknown>).customer)],
  ['phone missing', orderWith((b) => delete b.customer.phone)],
  ['phone 4 chars', orderWith((b) => (b.customer.phone = '0770'))],
  ['phone 4 chars after trim', orderWith((b) => (b.customer.phone = '  0770      '))],
  ['phone 41 chars', orderWith((b) => (b.customer.phone = '0'.repeat(41)))],
  ['phone number type', orderWith((b) => (b.customer.phone = 7_701_234_567))],
  ['governorate empty', orderWith((b) => (b.customer.governorate = ''))],
  ['governorate whitespace', orderWith((b) => (b.customer.governorate = '   '))],
  ['governorate 61 chars', orderWith((b) => (b.customer.governorate = 'م'.repeat(61)))],
  ['governorate not in the list (not checked here)', orderWith((b) => (b.customer.governorate = 'Atlantis'))],
  ['district missing', orderWith((b) => delete b.customer.district)],
  ['district 121 chars', orderWith((b) => (b.customer.district = 'x'.repeat(121)))],
  ['landmark empty', orderWith((b) => (b.customer.landmark = ''))],
  ['landmark whitespace', orderWith((b) => (b.customer.landmark = ' \n '))],
  ['landmark 201 chars', orderWith((b) => (b.customer.landmark = 'x'.repeat(201)))],
  ['name 101 chars', orderWith((b) => (b.customer.name = 'x'.repeat(101)))],
  ['name null', orderWith((b) => (b.customer.name = null))],
  ['notes 1001 chars', orderWith((b) => (b.customer.notes = 'x'.repeat(1_001)))],
  ['turnstile token 4097 chars', orderWith((b) => Object.assign(b, { turnstileToken: 'x'.repeat(4_097) }))],
  ['turnstile token number', orderWith((b) => Object.assign(b, { turnstileToken: 1 }))],
  ['several problems at once', { orderId: 'x', spec: { shape: 'circle', widthUm: 1, heightUm: 2 }, material: 1, sheets: 0, customer: { phone: '1' } }],
];

describe('golden: orderRequestSchema', () => {
  it('accept / reject table', () => {
    expect(ORDER_CASES.map(([label, body]) => `${label} -> ${verdict(orderRequestSchema.safeParse(body) as Parsed)}`)).toMatchSnapshot();
  });
});

describe('golden: clientLogSchema', () => {
  const CASES: [string, unknown][] = [
    ['minimal', { step: 'decode', message: 'boom' }],
    ['full', { step: 'upload', message: 'x', fileType: 'image/png', fileSize: 12_345, userAgent: 'Mozilla/5.0' }],
    ['every step: preview', { step: 'preview', message: '' }],
    ['every step: order', { step: 'order', message: 'm' }],
    ['every step: other', { step: 'other', message: 'm' }],
    ['unknown keys stripped', { step: 'other', message: 'm', secret: 1 }],
    ['fractional and negative fileSize are allowed', { step: 'other', message: 'm', fileSize: -1.5 }],
    ['message 1024 chars', { step: 'other', message: 'x'.repeat(1_024) }],
    ['message is not trimmed', { step: 'other', message: '  m  ' }],
    ['unknown step', { step: 'checkout', message: 'm' }],
    ['step missing', { message: 'm' }],
    ['message missing', { step: 'decode' }],
    ['message 1025 chars', { step: 'decode', message: 'x'.repeat(1_025) }],
    ['message number', { step: 'decode', message: 5 }],
    ['fileType 201 chars', { step: 'decode', message: 'm', fileType: 'x'.repeat(201) }],
    ['fileSize string', { step: 'decode', message: 'm', fileSize: '12' }],
    ['fileSize null', { step: 'decode', message: 'm', fileSize: null }],
    ['userAgent 1025 chars', { step: 'decode', message: 'm', userAgent: 'x'.repeat(1_025) }],
    ['null', null],
    ['array', [{ step: 'decode', message: 'm' }]],
  ];
  it('accept / reject table', () => {
    const rows = CASES.map(([label, body]) => {
      const v = verdict(clientLogSchema.safeParse(body) as Parsed);
      return `${label} -> ${v.length > 200 ? `${v.slice(0, 60)}… (${v.length} chars, sha ${sha256(v).slice(0, 12)})` : v}`;
    });
    expect(rows).toMatchSnapshot();
  });
});

/* ───────────────────────── defaults + settings schema ───────────────────────── */

describe('golden: config/defaults', () => {
  it('DEFAULT_SETTINGS (key order preserved) and the other exported constants', () => {
    expect(visible(JSON.stringify(DEFAULT_SETTINGS, null, 2))).toMatchSnapshot();
    expect({ ACCEPTED_MIME, ACCEPTED_EXTENSIONS, DISPLAY_NO_ALPHABET, SHOP_TIME_ZONE }).toMatchSnapshot();
  });
});

/** DEFAULT_SETTINGS clone typed loosely enough to be broken on purpose. */
interface LooseSettings {
  [key: string]: unknown;
  pricing: Record<string, unknown>;
  layout: Record<string, unknown>;
}
const settingsWith = (mutate: (s: LooseSettings) => void): unknown => {
  const s = structuredClone(DEFAULT_SETTINGS) as unknown as LooseSettings;
  mutate(s);
  return s;
};

describe('golden: shopSettingsSchema', () => {
  it('accepts the defaults unchanged', () => {
    const r = shopSettingsSchema.safeParse(DEFAULT_SETTINGS);
    expect({ success: r.success, equalToDefaults: r.success && canon(r.data) === canon(DEFAULT_SETTINGS), sameKeyOrder: r.success && JSON.stringify(r.data) === JSON.stringify(DEFAULT_SETTINGS) }).toMatchSnapshot();
  });

  const CASES: [string, unknown][] = [
    ['tiers are sorted ascending on parse', settingsWith((s) => (s.pricing.tiers = [{ minSheets: 100, percent: 20 }, { minSheets: 20, percent: 10 }, { minSheets: 50, percent: 15 }]))],
    ['unknown keys stripped at every level', settingsWith((s) => Object.assign(s, { offers: [{ id: 1 }], extra: true }, { layout: { ...s.layout, bleedUm: 1 } }))],
    ['boundary values accepted', settingsWith((s) => Object.assign(s, { whatsapp: '', deliveryFeeIqd: 0, maxUploadBytes: 1_024, retentionDays: 1 }, { layout: { ...s.layout, marginUm: 0, minSideUm: 1_000 } }))],
    ['only one material enabled', settingsWith((s) => (s.pricing.materials = { paper: { enabled: false, pricePerSheetIqd: 0 }, plastic: { enabled: true, pricePerSheetIqd: 1 } }))],
    ['empty tiers and quickPicks', settingsWith((s) => Object.assign(s.pricing, { tiers: [], quickPicks: [] }))],
  ];
  const BAD: [string, unknown][] = [
    ['null', null],
    ['empty object', {}],
    ['shopName empty', settingsWith((s) => (s.shopName = ''))],
    ['shopName 81 chars', settingsWith((s) => (s.shopName = 'x'.repeat(81)))],
    ['tagline 161 chars', settingsWith((s) => (s.tagline = 'x'.repeat(161)))],
    ['whatsapp with plus', settingsWith((s) => (s.whatsapp = '+9647701234567'))],
    ['whatsapp 16 digits', settingsWith((s) => (s.whatsapp = '1'.repeat(16)))],
    ['phone 41 chars', settingsWith((s) => (s.phone = '1'.repeat(41)))],
    ['telegramChatId number', settingsWith((s) => (s.telegramChatId = 12_345))],
    ['pricing missing', settingsWith((s) => delete (s as Record<string, unknown>).pricing)],
    ['both materials disabled', settingsWith((s) => (s.pricing.materials = { paper: { enabled: false, pricePerSheetIqd: 800 }, plastic: { enabled: false, pricePerSheetIqd: 1_500 } }))],
    ['material price negative', settingsWith((s) => (s.pricing.materials = { paper: { enabled: true, pricePerSheetIqd: -1 }, plastic: { enabled: true, pricePerSheetIqd: 1_500 } }))],
    ['material price fractional', settingsWith((s) => (s.pricing.materials = { paper: { enabled: true, pricePerSheetIqd: 800.5 }, plastic: { enabled: true, pricePerSheetIqd: 1_500 } }))],
    ['material missing', settingsWith((s) => (s.pricing.materials = { paper: { enabled: true, pricePerSheetIqd: 800 } }))],
    ['minSheets 0', settingsWith((s) => (s.pricing.minSheets = 0))],
    ['minSheets > maxSheets', settingsWith((s) => Object.assign(s.pricing, { minSheets: 50, maxSheets: 40 }))],
    ['maxSheets 100001', settingsWith((s) => (s.pricing.maxSheets = 100_001))],
    ['tier percent 91', settingsWith((s) => (s.pricing.tiers = [{ minSheets: 20, percent: 91 }]))],
    ['tier percent negative', settingsWith((s) => (s.pricing.tiers = [{ minSheets: 20, percent: -1 }]))],
    ['tier minSheets 0', settingsWith((s) => (s.pricing.tiers = [{ minSheets: 0, percent: 10 }]))],
    ['duplicate tier minSheets', settingsWith((s) => (s.pricing.tiers = [{ minSheets: 20, percent: 10 }, { minSheets: 20, percent: 15 }]))],
    ['21 tiers', settingsWith((s) => (s.pricing.tiers = Array.from({ length: 21 }, (_, i) => ({ minSheets: i + 1, percent: 1 }))))],
    ['9 quickPicks', settingsWith((s) => (s.pricing.quickPicks = [1, 2, 3, 4, 5, 6, 7, 8, 9]))],
    ['quickPick 0', settingsWith((s) => (s.pricing.quickPicks = [0]))],
    ['deliveryFee negative', settingsWith((s) => (s.deliveryFeeIqd = -1))],
    ['pricesPublished string', settingsWith((s) => (s.pricesPublished = 'yes'))],
    ['margin 50001', settingsWith((s) => (s.layout.marginUm = 50_001))],
    ['gap fractional', settingsWith((s) => (s.layout.circleGapXUm = 2_000.5))],
    ['minSide 999', settingsWith((s) => (s.layout.minSideUm = 999))],
    ['allowRotate missing', settingsWith((s) => delete s.layout.allowRotate)],
    ['roundedRadius 100001', settingsWith((s) => (s.layout.roundedRadiusUm = 100_001))],
    ['quality dpi 0', settingsWith((s) => (s.quality = { warnDpi: 0, blockDpi: 0, targetDpi: 71 }))],
    ['quality dpi too high', settingsWith((s) => (s.quality = { warnDpi: 2_401, blockDpi: 2_401, targetDpi: 1_201 }))],
    ['maxUploadBytes 1023', settingsWith((s) => (s.maxUploadBytes = 1_023))],
    ['maxUploadBytes > 100 MiB', settingsWith((s) => (s.maxUploadBytes = 100 * 1_024 * 1_024 + 1))],
    ['retentionDays 0', settingsWith((s) => (s.retentionDays = 0))],
    ['retentionDays 3651', settingsWith((s) => (s.retentionDays = 3_651))],
    ['legacy shape: offers instead of pricing', (() => {
      const { pricing: _pricing, ...rest } = structuredClone(DEFAULT_SETTINGS);
      void _pricing;
      return { ...rest, offers: [{ id: 'a', sheets: 10, priceIqd: 25_000 }] };
    })()],
  ];

  it('accepted inputs: what the parse changes (relative to the input)', () => {
    const rows = CASES.map(([label, input]) => {
      const r = shopSettingsSchema.safeParse(input);
      if (!r.success) return `${label} -> ${verdict(r as Parsed)}`;
      return `${label} -> ok pricing=${canon(r.data.pricing)} topKeys=${Object.keys(r.data).join(',')} layoutKeys=${Object.keys(r.data.layout).join(',')} sha=${sha256(canon(r.data)).slice(0, 16)}`;
    });
    expect(rows).toMatchSnapshot();
  });

  it('rejected inputs: issue paths and codes', () => {
    expect(BAD.map(([label, input]) => `${label} -> ${verdict(shopSettingsSchema.safeParse(input) as Parsed)}`)).toMatchSnapshot();
  });

  it('pricingSchema alone', () => {
    const p = DEFAULT_SETTINGS.pricing;
    expect([
      `defaults -> ${verdict(pricingSchema.safeParse(p) as Parsed)}`,
      `unsorted tiers -> ${verdict(pricingSchema.safeParse({ ...p, tiers: [...p.tiers].reverse() }) as Parsed)}`,
      `min > max -> ${verdict(pricingSchema.safeParse({ ...p, minSheets: 10, maxSheets: 9 }) as Parsed)}`,
      `empty -> ${verdict(pricingSchema.safeParse({}) as Parsed)}`,
    ]).toMatchSnapshot();
  });
});

/* ───────────────────────── local adapter: settings ───────────────────────── */

/** Leaf-level differences from DEFAULT_SETTINGS: "path: default -> actual" (added / removed keys included). */
function diffFromDefaults(actual: unknown): string[] {
  const flatten = (v: unknown, prefix: string, out: Map<string, string>) => {
    if (Array.isArray(v)) {
      out.set(`${prefix}.length`, String(v.length));
      v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
    } else if (v && typeof v === 'object') {
      const keys = Object.keys(v as Record<string, unknown>);
      if (keys.length === 0) out.set(prefix, '{}');
      for (const k of keys) flatten((v as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
    } else out.set(prefix, show(v));
  };
  const a = new Map<string, string>();
  const d = new Map<string, string>();
  flatten(actual, '', a);
  flatten(DEFAULT_SETTINGS, '', d);
  const rows: string[] = [];
  for (const key of [...new Set([...d.keys(), ...a.keys()])].sort()) {
    if (a.get(key) !== d.get(key)) rows.push(`${key}: ${d.get(key) ?? '(absent)'} -> ${a.get(key) ?? '(absent)'}`);
  }
  return rows;
}

describe('golden: LocalStorage.getSettings', () => {
  afterEach(() => vi.restoreAllMocks());

  const legacy = {
    shopName: 'الاتحاد برنت',
    tagline: 'قديم',
    whatsapp: '9647700000000',
    offers: [
      { id: 'o1', sheets: 10, priceIqd: 25_000, enabled: true },
      { id: 'o2', sheets: 20, priceIqd: 45_000, enabled: true },
    ],
    deliveryFeeIqd: 4_000,
    pricesPublished: false,
    layout: { marginUm: 10_000 },
  };

  const FILES: [string, string | null][] = [
    ['(a) no settings.json', null],
    ['(b) partial file', JSON.stringify({ shopName: 'مطبعة تجريبية', whatsapp: '9647709999999', deliveryFeeIqd: 3_000, layout: { allowRotate: true, marginUm: 5_000 }, quality: { warnDpi: 120 } })],
    ['(b2) partial pricing: arrays replace, objects merge', JSON.stringify({ pricing: { materials: { plastic: { enabled: false } }, minSheets: 5, tiers: [{ minSheets: 200, percent: 30 }, { minSheets: 30, percent: 5 }], quickPicks: [5] } })],
    ['(c) legacy file with offers and no pricing', JSON.stringify(legacy)],
    ['(d) invalid JSON', '{ "shopName": "x", '],
    ['(d2) empty file', ''],
    ['(e) valid JSON, one invalid value -> ALL defaults', JSON.stringify({ shopName: 'kept?', deliveryFeeIqd: -5 })],
    ['(e2) valid JSON, several invalid values', JSON.stringify({ whatsapp: '+964', pricing: { minSheets: 0, tiers: [{ minSheets: 1, percent: 99 }] }, layout: { minSideUm: 1 } })],
    ['(f) JSON null', 'null'],
    ['(f2) JSON array', '[1,2,3]'],
    ['(f3) JSON number', '42'],
    ['(f4) JSON string', '"settings"'],
    ['(g) explicit nulls', JSON.stringify({ tagline: null, pricing: null })],
    ['(h) full defaults written by saveSettings', JSON.stringify(DEFAULT_SETTINGS, null, 2)],
    ['(i) UTF-8 BOM before valid JSON', `\ufeff${JSON.stringify({ shopName: 'bom' })}`],
  ];

  it('settings.json variants -> returned settings (diff from defaults + hash) and what is logged', async () => {
    const out: Record<string, unknown> = {};
    for (const [label, content] of FILES) {
      const dir = tmp();
      if (content !== null) writeFileSync(path.join(dir, 'settings.json'), content, 'utf8');
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const settings = await new LocalStorage(dir).getSettings();
      const logged = err.mock.calls.map((args) => [String(args[0]), String(args[0]).includes('unreadable') ? '<PARSE_ERROR>' : String(args[1])]);
      err.mockRestore();
      out[label] = {
        equalsDefaults: canon(settings) === canon(DEFAULT_SETTINGS),
        isFreshObject: settings !== DEFAULT_SETTINGS && settings.pricing !== DEFAULT_SETTINGS.pricing,
        diffFromDefaults: diffFromDefaults(settings),
        sha256: sha256(canon(settings)),
        logged,
      };
    }
    expect(out).toMatchSnapshot();
  });

  it('the legacy and partial results in full', async () => {
    const run = async (content: string): Promise<ShopSettings> => {
      const dir = tmp();
      writeFileSync(path.join(dir, 'settings.json'), content, 'utf8');
      return new LocalStorage(dir).getSettings();
    };
    expect({ legacy: await run(FILES[3][1] as string), partial: await run(FILES[1][1] as string) }).toMatchSnapshot();
  });

  it('saveSettings writes pretty JSON and round-trips; the result can be mutated safely', async () => {
    const s = new LocalStorage(tmp());
    const custom: ShopSettings = { ...structuredClone(DEFAULT_SETTINGS), shopName: 'مطبعة', whatsapp: '9647709999999', pricesPublished: false };
    await s.saveSettings(custom);
    const text = readFileSync(path.join(s.root, 'settings.json'), 'utf8');
    const back = await s.getSettings();
    back.pricing.tiers.push({ minSheets: 999, percent: 1 });
    const again = await s.getSettings();
    expect({
      fileIsPrettyJsonOfInput: text === JSON.stringify(custom, null, 2),
      fileSha256: sha256(text),
      roundTripEqual: canon(again) === canon(custom),
      mutationDidNotLeak: again.pricing.tiers.length === custom.pricing.tiers.length && DEFAULT_SETTINGS.pricing.tiers.length === 3,
      filesOnDisk: readdirSync(s.root).sort(),
    }).toMatchSnapshot();
  });
});

describe('golden: deepMerge', () => {
  it('table', () => {
    const cases: [string, unknown, unknown][] = [
      ['scalar over scalar', 1, 2],
      ['undefined keeps base', { a: 1 }, undefined],
      ['null replaces base', { a: 1 }, null],
      ['array replaces object', { a: 1 }, [1, 2]],
      ['object over scalar', 5, { a: 1 }],
      ['nested merge', { a: { b: 1, c: 2 }, d: 3 }, { a: { c: 9 } }],
      ['arrays are replaced, not merged', { a: [1, 2, 3] }, { a: [9] }],
      ['new keys are added', { a: 1 }, { b: 2 }],
      ['nested undefined keeps base', { a: { b: 1 } }, { a: { b: undefined } }],
      ['nested null replaces', { a: { b: 1 } }, { a: null }],
      ['over has object where base has scalar', { a: 1 }, { a: { x: 1 } }],
      ['empty over', { a: 1 }, {}],
    ];
    expect(cases.map(([label, base, over]) => `${label}: ${show(base)} + ${show(over)} -> ${show(deepMerge(base, over))}`)).toMatchSnapshot();
  });
});

/* ───────────────────────── local adapter: files, orders, events, customers ───────────────────────── */

function record(orderId: string, createdAt: string, over: { customer?: Partial<OrderRecord['customer']>; totalIqd?: number | null; displayNo?: string; uploadId?: string } = {}): OrderRecord {
  const total = over.totalIqd === undefined ? 19_400 : over.totalIqd;
  const customer: OrderRecord['customer'] = { phone: '9647701234567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر', ...over.customer };
  if (!over.customer || !('name' in over.customer)) customer.name = 'علي';
  return {
    orderId,
    displayNo: over.displayNo ?? `EP-261101-${orderId.slice(-4).toUpperCase()}`,
    createdAt,
    status: 'new',
    spec: { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
    layout: { cols: 6, rows: 9, countPerSheet: 54, rotated: false, turnedCount: 0, cellWidthUm: 30_000, cellHeightUm: 30_000, gapXUm: 2_000, gapYUm: 0 },
    design: { kind: 'png', originalName: 'logo.png', bytes: 3, pxWidth: 900, pxHeight: 900, effectiveDpi: 762 },
    price: {
      material: 'paper',
      sheets: 20,
      unitBaseIqd: total === null ? null : 800,
      discountPercent: 10,
      unitPriceIqd: total === null ? null : 720,
      subtotalIqd: total === null ? null : total - 5_000,
      deliveryFeeIqd: 5_000,
      totalIqd: total,
      totalStickers: 1_080,
      perStickerIqd: total === null ? null : 18,
    },
    customer,
    files: { designPath: `uploads/${over.uploadId ?? orderId}.bin`, pdfPath: `orders/${orderId}.pdf` },
    notified: { telegram: 'skipped' },
  };
}

/** Every file under root as a sorted list of POSIX-style relative paths. */
function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

const fail = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
    return 'no error';
  } catch (e) {
    return `throws ${(e as Error).message}`;
  }
};

describe('golden: storage paths', () => {
  it('path helpers and ID_RE', () => {
    const ids = ['abcdefgh', 'abcdefg', 'a'.repeat(64), 'a'.repeat(65), 'order-aaaa_AAA-123', 'has space', 'dot.dot.dot', '../../x', 'ünïcödé-id', '', 'abcdefgh\n'];
    expect({
      source: ID_RE.source,
      flags: ID_RE.flags,
      ids: ids.map((id) => `${show(id.length > 20 ? `${id.slice(0, 8)}…(${id.length})` : id)} -> ${ID_RE.test(id)}`),
      paths: [uploadPath('ID'), uploadMetaPath('ID'), orderJsonPath('ID'), pdfPath('ID')],
    }).toMatchSnapshot();
  });
});

describe('golden: LocalStorage uploads and files', () => {
  it('saveUpload / readUpload / savePdf / readFile / deleteFile and what lands on disk', async () => {
    const s = new LocalStorage(tmp());
    const meta: StoredFileMeta = { mime: 'image/png', originalName: 'شعار logo.png', bytes: 3, createdAt: '2026-11-01T08:00:00.000Z' };
    const p = await s.saveUpload('upload-id-0001', new Uint8Array([1, 2, 3]), meta);
    const pdf = await s.savePdf('order-id-00001', new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const back = await s.readUpload('upload-id-0001');
    const metaFile = readFileSync(path.join(s.root, 'uploads', 'upload-id-0001.json'), 'utf8');
    const before = tree(s.root);
    await s.deleteFile(p);
    await s.deleteFile(p); // second delete of a missing file is a no-op
    expect({
      uploadPath: p,
      pdfPath: pdf,
      metaFileText: visible(metaFile),
      readUpload: back ? { bytes: Array.from(back.bytes), meta: back.meta, bytesIsUint8Array: back.bytes.constructor.name } : null,
      readFile: Array.from((await s.readFile(pdf)) ?? []),
      readFileMissing: await s.readFile('orders/nope-nope.pdf'),
      readUploadMissing: await s.readUpload('missing-id-0001'),
      readUploadAfterBinDeleted: await s.readUpload('upload-id-0001'),
      treeBefore: before,
      treeAfterDelete: tree(s.root),
    }).toMatchSnapshot();
  });

  it('invalid ids and path traversal', async () => {
    const s = new LocalStorage(tmp());
    const meta: StoredFileMeta = { mime: 'image/png', originalName: 'a.png', bytes: 1, createdAt: '2026-11-01T08:00:00.000Z' };
    const badIds = ['short', '../../etc/passwd', 'has space 123', 'a'.repeat(65), ''];
    const badPaths = ['', '/etc/passwd', '../x', 'uploads/../../x', 'uploads//x', './x', 'uploads/./x', 'uploads\\x', 'C:/Windows/win.ini', 'c:\\x', 'uploads/x\0.bin', 'uploads/', 'a/b/..'];
    const rows: string[] = [];
    for (const id of badIds) {
      rows.push(`saveUpload(${show(id.slice(0, 20))}) -> ${await fail(() => s.saveUpload(id, new Uint8Array([1]), meta))}`);
      rows.push(`savePdf(${show(id.slice(0, 20))}) -> ${await fail(() => s.savePdf(id, new Uint8Array([1])))}`);
      rows.push(`readUpload(${show(id.slice(0, 20))}) -> ${show(await s.readUpload(id))}`);
      rows.push(`getOrder(${show(id.slice(0, 20))}) -> ${show(await s.getOrder(id))}`);
      rows.push(`saveOrder(${show(id.slice(0, 20))}) -> ${await fail(() => s.saveOrder(record(id, '2026-11-01T08:00:00.000Z')))}`);
      rows.push(`updateOrder(${show(id.slice(0, 20))}) -> ${show(await s.updateOrder(id, { status: 'done' }))}`);
    }
    for (const rel of badPaths) {
      rows.push(`readFile(${show(rel)}) -> ${await fail(() => s.readFile(rel))}`);
      rows.push(`deleteFile(${show(rel)}) -> ${await fail(() => s.deleteFile(rel))}`);
    }
    rows.push(`readFile(settings.json) -> ${await fail(() => s.readFile('settings.json'))}`);
    rows.push(`readFile(a/b/c.txt) -> ${await fail(() => s.readFile('a/b/c.txt'))}`);
    expect({ rows, nothingWritten: tree(s.root) }).toMatchSnapshot();
  });

  it('a corrupt upload meta makes readUpload return null', async () => {
    const s = new LocalStorage(tmp());
    mkdirSync(path.join(s.root, 'uploads'), { recursive: true });
    writeFileSync(path.join(s.root, 'uploads', 'upload-id-0002.bin'), new Uint8Array([1]));
    const onlyBin = await s.readUpload('upload-id-0002');
    writeFileSync(path.join(s.root, 'uploads', 'upload-id-0002.json'), '{torn');
    expect({ onlyBin, corruptMeta: await s.readUpload('upload-id-0002') }).toMatchSnapshot();
  });
});

describe('golden: LocalStorage orders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saveOrder file text, getOrder, listOrders (newest first), updateOrder', async () => {
    const s = new LocalStorage(tmp());
    const a = record('order-id-0000a', '2026-11-01T08:00:00.000Z');
    const b = record('order-id-0000b', '2026-11-03T08:00:00.000Z', { customer: { name: undefined, notes: 'ملاحظة' }, totalIqd: null });
    const c = record('order-id-0000c', '2026-11-02T08:00:00.000Z');
    // Distinct instants only: the order of equal createdAt values follows readdir order (filesystem specific).
    const d = record('order-id-0000d', '2026-11-02T08:00:00.001Z');
    for (const r of [a, b, c, d]) await s.saveOrder(r);
    const fileA = readFileSync(path.join(s.root, 'orders', 'order-id-0000a.json'), 'utf8');
    const fileB = readFileSync(path.join(s.root, 'orders', 'order-id-0000b.json'), 'utf8');

    const listed = (await s.listOrders()).map((r) => `${r.orderId} ${r.createdAt}`);
    const updated = await s.updateOrder('order-id-0000a', { status: 'printing', notified: { telegram: 'sent' } });
    const statusOnly = await s.updateOrder('order-id-0000b', { status: 'cancelled' });
    const extraKeys = await s.updateOrder('order-id-0000c', { status: 'done', displayNo: 'HACKED' } as never);
    const missing = await s.updateOrder('order-id-zzzzz', { status: 'done' });

    expect({
      fileA: visible(fileA),
      fileAIsPrettyJson: fileA === JSON.stringify(a, null, 2),
      fileBKeepsNoUndefined: visible(fileB),
      getA: canon(await s.getOrder('order-id-0000a')) === canon(updated),
      getMissing: await s.getOrder('order-id-zzzzz'),
      listed,
      updated: updated ? { status: updated.status, notified: updated.notified, restUnchanged: canon({ ...updated, status: 'new', notified: { telegram: 'skipped' } }) === canon(a) } : null,
      statusOnly: statusOnly ? { status: statusOnly.status, notified: statusOnly.notified } : null,
      patchIsSpreadVerbatim: extraKeys ? { status: extraKeys.status, displayNo: extraKeys.displayNo } : null,
      missing,
      tree: tree(s.root),
    }).toMatchSnapshot();
  });

  it('corrupt and foreign files in orders/ are skipped', async () => {
    const s = new LocalStorage(tmp());
    expect(await s.listOrders()).toEqual([]);
    await s.saveOrder(record('order-id-0000a', '2026-11-01T08:00:00.000Z'));
    writeFileSync(path.join(s.root, 'orders', 'order-id-0000x.json'), '{torn');
    writeFileSync(path.join(s.root, 'orders', 'order-id-0000a.pdf'), 'pdf');
    writeFileSync(path.join(s.root, 'orders', 'bad name.json'), '{}');
    writeFileSync(path.join(s.root, 'orders', 'notes.txt'), 'x');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listed = (await s.listOrders()).map((r) => r.orderId);
    expect({ listed, logged: err.mock.calls.map((c) => c.map(String)) }).toMatchSnapshot();
  });
});

describe('golden: LocalStorage analytics events', () => {
  const ev = (ts: string, over: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({ ts, type: 'pageview', visitor: 'v1', path: '/', ...over });

  it('recordEvent file layout (one JSON line per event, UTC month) and listEvents', async () => {
    const s = new LocalStorage(tmp());
    const events: AnalyticsEvent[] = [
      ev('2026-11-02T09:00:00.000Z', { source: 'instagram', device: 'mobile', city: 'Baghdad', region: 'BG', country: 'IQ' }),
      ev('2026-10-31T23:59:59.999Z'),
      ev('2026-10-31T21:30:00.000Z', { type: 'step', step: 'size' }), // already November in Baghdad, still the October file
      ev('2026-11-03T00:00:00.000Z', { type: 'order', meta: { material: 'paper', sheets: 20, totalIqd: 19_400, governorate: 'بغداد', shape: 'circle', widthMm: 30, heightMm: 30 } }),
      ev('2026-11-02T09:00:00.000Z', { visitor: 'v2', type: 'upload', meta: { kind: 'png' } }),
      ev('2026-11-01T00:00:00+03:00', { visitor: 'v3' }), // offset timestamp: UTC month is October
      ev('2025-12-31T23:59:59.000Z', { type: 'install', step: 'installed' }),
    ];
    for (const e of events) await s.recordEvent(e);
    const files = Object.fromEntries(
      tree(s.root).map((rel) => [rel, visible(readFileSync(path.join(s.root, rel), 'utf8'))]),
    );
    const list = async (since: string) => (await s.listEvents(new Date(since))).map((e) => `${e.ts} ${e.type} ${e.visitor}`);
    expect({
      files,
      all: await list('2000-01-01T00:00:00Z'),
      sinceNov1Utc: await list('2026-11-01T00:00:00Z'),
      sinceOct31Late: await list('2026-10-31T21:30:00.000Z'),
      sinceExactTs: await list('2026-11-02T09:00:00.000Z'),
      since2027: await list('2027-01-01T00:00:00Z'),
      roundTripsMeta: canon((await s.listEvents(new Date('2026-11-03T00:00:00Z')))[0]) === canon(events[3]),
    }).toMatchSnapshot();
  });

  it('invalid timestamp is rejected; torn lines and foreign files are ignored', async () => {
    const s = new LocalStorage(tmp());
    const empty = await s.listEvents(new Date(0));
    const bad = await fail(() => s.recordEvent(ev('not-a-date')));
    await s.recordEvent(ev('2026-11-02T09:00:00.000Z'));
    const file = path.join(s.root, 'analytics', 'events-2026-11.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf8')}{torn\n\n   \n${JSON.stringify(ev('2026-11-02T10:00:00.000Z'))}\n${JSON.stringify(ev('garbage-ts'))}\n`);
    writeFileSync(path.join(s.root, 'analytics', 'notes.txt'), JSON.stringify(ev('2026-11-02T11:00:00.000Z')));
    writeFileSync(path.join(s.root, 'analytics', 'events-2026-1.jsonl'), JSON.stringify(ev('2026-01-02T11:00:00.000Z')));
    expect({ empty, bad, listed: (await s.listEvents(new Date(0))).map((e) => e.ts), treeAfterBad: tree(s.root) }).toMatchSnapshot();
  });

  it('purgeEventsOlderThan removes whole months that ended before the cutoff', async () => {
    const s = new LocalStorage(tmp());
    for (const ts of ['2025-01-10T00:00:00.000Z', '2026-05-31T23:59:59.000Z', '2026-06-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z']) await s.recordEvent(ev(ts));
    const cutoffs = ['2026-05-31T23:59:59.999Z', '2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.999Z', '2026-07-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z'];
    const dry: Record<string, string[]> = {};
    for (const c of cutoffs) dry[c] = (await s.purgeEventsOlderThan(new Date(c), true)).sort();
    const treeAfterDry = tree(s.root);
    const removed = (await s.purgeEventsOlderThan(new Date('2026-06-01T00:00:00.000Z'), false)).sort();
    expect({ dry, treeAfterDry, removed, treeAfterReal: tree(s.root), noAnalyticsDir: await new LocalStorage(tmp()).purgeEventsOlderThan(new Date(), true) }).toMatchSnapshot();
  });
});

describe('golden: LocalStorage customers', () => {
  it('upsert sequence -> customers.json text and listCustomers order', async () => {
    const s = new LocalStorage(tmp());
    const empty = await s.listCustomers();
    await s.upsertCustomerFromOrder(record('order-id-00001', '2026-11-02T10:00:00.000Z'));
    const afterFirst = readFileSync(path.join(s.root, 'customers.json'), 'utf8');
    // another customer, no name, unpriced order
    await s.upsertCustomerFromOrder(record('order-id-00002', '2026-11-03T10:00:00.000Z', { customer: { phone: '9647801112222', name: undefined, governorate: 'البصرة', district: '', landmark: 'x' }, totalIqd: null }));
    // returning customer: new address, no name -> name kept
    await s.upsertCustomerFromOrder(record('order-id-00003', '2026-11-04T10:00:00.000Z', { customer: { name: undefined, district: 'المنصور', landmark: 'جنب المول' }, totalIqd: 2_500 }));
    // an OLDER order arriving late: firstOrderAt moves back, last* stay, name replaced
    await s.upsertCustomerFromOrder(record('order-id-00004', '2026-11-01T10:00:00.000Z', { customer: { name: 'علي حسين' }, totalIqd: 1_000 }));
    // same instant as the current last order: last* move to this order (>=)
    await s.upsertCustomerFromOrder(record('order-id-00005', '2026-11-04T10:00:00.000Z', { totalIqd: 0 }));
    // the SAME order id again is counted again (no de-duplication in the adapter)
    await s.upsertCustomerFromOrder(record('order-id-00005', '2026-11-04T10:00:00.000Z', { totalIqd: 0 }));
    // third customer, empty-string name
    await s.upsertCustomerFromOrder(record('order-id-00006', '2026-11-03T10:00:00.000Z', { customer: { phone: '9647501112222', name: '' } }));
    const finalText = readFileSync(path.join(s.root, 'customers.json'), 'utf8');
    expect({
      empty,
      afterFirst: visible(afterFirst),
      finalText: visible(finalText),
      listed: (await s.listCustomers()).map((c) => `${c.phone} last=${c.lastOrderAt} orders=${c.ordersCount} total=${c.totalIqd} name=${show(c.name)}`),
      tree: tree(s.root),
    }).toMatchSnapshot();
  });

  it('concurrent upserts are serialised; an unreadable file is never overwritten', async () => {
    const s = new LocalStorage(tmp());
    await Promise.all(Array.from({ length: 12 }, (_, i) => s.upsertCustomerFromOrder(record(`order-id-1${String(i).padStart(4, '0')}`, `2026-11-${String((i % 9) + 1).padStart(2, '0')}T10:00:00.000Z`, { totalIqd: 1_000 * (i + 1) }))));
    const [c] = await s.listCustomers();

    const broken = new LocalStorage(tmp());
    writeFileSync(path.join(broken.root, 'customers.json'), '{torn');
    const upsert = await fail(() => broken.upsertCustomerFromOrder(record('order-id-00001', '2026-11-02T10:00:00.000Z')));
    const list = await fail(() => broken.listCustomers());
    const stillTorn = readFileSync(path.join(broken.root, 'customers.json'), 'utf8');
    // The lock recovers: after the file is repaired the next upsert works.
    writeFileSync(path.join(broken.root, 'customers.json'), '{"not":"an array"}');
    await broken.upsertCustomerFromOrder(record('order-id-00001', '2026-11-02T10:00:00.000Z'));
    expect({ concurrent: c, upsert, list, stillTorn, afterRepair: (await broken.listCustomers()).map((x) => x.phone) }).toMatchSnapshot();
  });
});

describe('golden: LocalStorage.purgeOlderThan', () => {
  it('orders older than the cutoff, their files, orphan uploads and .tmp leftovers (by mtime)', async () => {
    const s = new LocalStorage(tmp());
    const meta = (createdAt: string): StoredFileMeta => ({ mime: 'image/png', originalName: 'a.png', bytes: 1, createdAt });
    const OLD = new Date('2026-09-01T00:00:00.000Z');
    const NEW = new Date('2026-11-05T00:00:00.000Z');
    const touch = (rel: string, when: Date) => utimesSync(path.join(s.root, rel), when, when);
    const add = async (orderId: string, createdAt: string, uploadId: string, uploadMtime: Date) => {
      await s.saveUpload(uploadId, new Uint8Array([1]), meta(createdAt));
      await s.savePdf(orderId, new Uint8Array([2]));
      await s.saveOrder(record(orderId, createdAt, { uploadId }));
      touch(`uploads/${uploadId}.bin`, uploadMtime);
      touch(`uploads/${uploadId}.json`, uploadMtime);
    };
    await add('order-old-0001', '2026-09-10T00:00:00.000Z', 'upload-old-0001', OLD); // old order, own upload
    await add('order-old-0002', '2026-09-20T00:00:00.000Z', 'upload-shared-01', OLD); // old order sharing an upload…
    await add('order-new-0001', '2026-11-04T00:00:00.000Z', 'upload-shared-01', OLD); // …with a kept order
    await add('order-new-0002', '2026-11-05T00:00:00.000Z', 'upload-new-0002', NEW);
    await add('order-edge-001', '2026-10-11T09:00:00.000Z', 'upload-edge-001', NEW); // exactly at the cutoff -> kept
    // orphan uploads (no order)
    await s.saveUpload('upload-orphan-old', new Uint8Array([1]), meta('2026-09-01T00:00:00.000Z'));
    touch('uploads/upload-orphan-old.bin', OLD);
    await s.saveUpload('upload-orphan-new', new Uint8Array([1]), meta('2026-11-05T00:00:00.000Z'));
    touch('uploads/upload-orphan-new.bin', NEW);
    // never-committed direct upload (bin without meta) and interrupted writes
    writeFileSync(path.join(s.root, 'uploads', 'upload-nometa-old.bin'), 'x');
    touch('uploads/upload-nometa-old.bin', OLD);
    writeFileSync(path.join(s.root, 'uploads', 'x.bin.123.456.tmp'), 'x');
    touch('uploads/x.bin.123.456.tmp', OLD);
    writeFileSync(path.join(s.root, 'orders', 'y.json.123.456.tmp'), 'x');
    touch('orders/y.json.123.456.tmp', NEW);
    // an old order whose PDF is already gone
    await s.saveOrder(record('order-old-0003', '2026-08-01T00:00:00.000Z', { uploadId: 'upload-gone-0003' }));
    await s.upsertCustomerFromOrder(record('order-old-0001', '2026-09-10T00:00:00.000Z'));
    await s.recordEvent({ ts: '2026-09-10T00:00:00.000Z', type: 'pageview', visitor: 'v' });

    const cutoff = new Date('2026-10-11T09:00:00.000Z');
    const before = tree(s.root);
    const dry = await s.purgeOlderThan(cutoff, true);
    const afterDry = tree(s.root);
    const real = await s.purgeOlderThan(cutoff, false);
    const after = tree(s.root);
    const again = await s.purgeOlderThan(cutoff, false);
    expect({
      before,
      // Sorted: the order inside the returned list follows readdir order (filesystem specific).
      dryRunReports: [...dry].sort(),
      dryRunChangedNothing: canon(afterDry) === canon(before),
      realRunReports: [...real].sort(),
      after,
      secondRunRemoves: again,
      emptyRoot: await new LocalStorage(tmp()).purgeOlderThan(cutoff, false),
    }).toMatchSnapshot();
  });
});

describe('golden: getStorage() factory (local)', () => {
  afterEach(() => {
    delete process.env.STORAGE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
  });

  it('caches one LocalStorage per DATA_DIR; supabase needs its two variables', async () => {
    const saved = process.env.DATA_DIR;
    const dirA = tmp();
    const dirB = tmp();
    delete process.env.STORAGE;
    process.env.DATA_DIR = dirA;
    const a1 = getStorage();
    const a2 = getStorage();
    process.env.DATA_DIR = `  ${dirA}  `;
    const a3 = getStorage();
    process.env.DATA_DIR = dirB;
    const b1 = getStorage();
    process.env.DATA_DIR = dirA;
    const a4 = getStorage();
    process.env.STORAGE = 'supabase';
    const noVars = await fail(() => getStorage());
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    const noSecret = await fail(() => getStorage());
    process.env.STORAGE = ' local ';
    const localAgain = getStorage();
    process.env.STORAGE = 'blob';
    const unknownFallsBackToLocal = getStorage();
    if (saved === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = saved;
    expect({
      isLocal: a1 instanceof LocalStorage,
      rootIsResolvedDataDir: (a1 as LocalStorage).root === path.resolve(dirA),
      sameInstanceForSameDir: a1 === a2,
      dataDirIsTrimmed: a3 === a1,
      differentDirNewInstance: b1 !== a1 && (b1 as LocalStorage).root === path.resolve(dirB),
      switchingBackCreatesANewInstance: a4 !== a1,
      noVars,
      noSecret,
      storageValueIsTrimmed: localAgain instanceof LocalStorage,
      unknownStorageValueIsLocal: unknownFallsBackToLocal instanceof LocalStorage,
      localAdapterHasCreateDirectUpload: 'createDirectUpload' in a1,
    }).toMatchSnapshot();
  });
});
