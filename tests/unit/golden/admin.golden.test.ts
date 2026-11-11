/**
 * GOLDEN (extra, not in the original list) — the admin side that has real logic but no page
 * rendering: server actions (src/app/admin/actions.ts), admin helpers (src/app/admin/_lib.ts,
 * customers/filter.ts, api/admin/customers/csv.ts) and GET /api/admin/files/[orderId]/[which].
 *
 * Next.js request APIs are mocked the way tests/unit/server/session.test.ts does it:
 *   next/headers    -> an in-memory cookie jar + settable request headers
 *   next/navigation -> redirect(url) throws "NEXT_REDIRECT <url>" (the real one also throws)
 *   next/cache      -> revalidatePath calls are recorded
 * Date is frozen at 2026-11-10T09:00:00Z, so the session JWT is a fixed string (test secret);
 * its decoded header/payload and a sha256 of the whole token are stored, not the token.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { OrderRecord, ShopSettings, StorageAdapter } from '@/lib/types';
import { SECRET, setupEnv } from '../server/helpers';
import { canon, removeTempDirs, sha256, show, track, visible } from './_util';

const jar = new Map<string, { value: string; options?: unknown }>();
let requestHeaders: Record<string, string> = {};
const revalidated: unknown[][] = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)?.value } : undefined),
    set: (k: string, v: string, options?: unknown) => void jar.set(k, { value: v, options }),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(requestHeaders),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => void revalidated.push(args) }));

let fake: StorageAdapter | null = null;
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { getStorage: () => fake ?? actual.getStorage() };
});

import { formatBaghdad, orderPriceView, statusVariant, telegramLabel } from '@/app/admin/_lib';
import { loginAction, logoutAction, saveSettingsAction, updateOrderStatus } from '@/app/admin/actions';
import { matchesQuery, type CustomerRow } from '@/app/admin/customers/filter';
import { CSV_BOM, csvCell, csvDate, customersToCsv, phoneForCsv } from '@/app/api/admin/customers/csv';
import { GET as filesRoute } from '@/app/api/admin/files/[orderId]/[which]/route';
import { COOKIE_NAME, signToken } from '@/lib/auth/token';
import { getStorage } from '@/lib/storage';

const FROZEN = new Date('2026-11-10T09:00:00.000Z');
const freshEnv = () => track(setupEnv());

beforeEach(() => {
  vi.setSystemTime(FROZEN);
  freshEnv();
  jar.clear();
  requestHeaders = {};
  revalidated.length = 0;
  fake = null;
});
afterEach(() => {
  fake = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(removeTempDirs);

/** "returned <value>" | "redirect -> <url>" | "THROWS <message>". */
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    return `returned ${visible(show(await fn()))}`;
  } catch (e) {
    const m = (e as Error).message;
    return m.startsWith('NEXT_REDIRECT ') ? `redirect -> ${m.slice('NEXT_REDIRECT '.length)}` : `THROWS ${m}`;
  }
}

const login = async () => void jar.set(COOKIE_NAME, { value: await signToken(SECRET) });
const form = (fields: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/* ───────────────────────── pure admin helpers ───────────────────────── */

describe('golden: admin/_lib', () => {
  it('statusVariant, telegramLabel, formatBaghdad', () => {
    const instants = ['2026-11-10T09:00:00.000Z', '2026-11-09T20:59:00.000Z', '2026-11-09T21:00:00.000Z', '2026-06-15T13:45:30.000Z', '2026-01-01T00:00:00.000Z'];
    expect({
      statusVariant,
      telegramLabel,
      formatBaghdad: instants.map((i) => `${i} -> ${visible(formatBaghdad(i))}`),
    }).toMatchSnapshot();
  });
  it('formatBaghdad with an invalid date throws', async () => {
    expect(await outcome(async () => formatBaghdad('not-a-date'))).toMatchSnapshot();
  });
  it('orderPriceView: current, legacy (offer) and broken records', () => {
    const price: OrderRecord['price'] = { material: 'plastic', sheets: 50, unitBaseIqd: 1_500, discountPercent: 15, unitPriceIqd: 1_275, subtotalIqd: 63_750, deliveryFeeIqd: 5_000, totalIqd: 68_750, totalStickers: 2_700, perStickerIqd: 25 };
    const rec = (over: Record<string, unknown>) => ({ orderId: 'o', ...over }) as unknown as OrderRecord;
    expect({
      current: orderPriceView(rec({ price })),
      unpriced: orderPriceView(rec({ price: { ...price, unitPriceIqd: null, subtotalIqd: null, totalIqd: null, discountPercent: 0 } })),
      legacyOffer: orderPriceView(rec({ offer: { id: 'o1', sheets: 10, priceIqd: 25_000 }, price: { offerPriceIqd: 25_000, deliveryFeeIqd: 5_000, totalIqd: 30_000, totalStickers: 540 } })),
      legacyOfferOnly: orderPriceView(rec({ offer: { sheets: 20 } })),
      priceSheetsWinOverOffer: orderPriceView(rec({ offer: { sheets: 20 }, price: { sheets: 7 } })),
      nothing: orderPriceView(rec({})),
      zeroValuesAreKept: orderPriceView(rec({ price: { sheets: 0, discountPercent: 0, deliveryFeeIqd: 0, totalIqd: 0, totalStickers: 0 } })),
    }).toMatchSnapshot();
  });
});

describe('golden: customers filter and CSV helpers', () => {
  it('matchesQuery table', () => {
    const rows: CustomerRow[] = [
      { phone: '9647701234567', name: 'علي حسين', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر', ordersCount: 2, totalIqd: 38_800, lastLabel: '', lastDisplayNo: 'EP-261110-AB3C', lastOrderId: 'o1' },
      { phone: '9647801112222', name: '', governorate: 'البصرة', district: '', landmark: '', ordersCount: 1, totalIqd: 0, lastLabel: '', lastDisplayNo: 'EP-1', lastOrderId: null },
      { phone: '9647501112222', name: 'Sara Ahmed', governorate: 'أربيل', district: 'عنكاوا', landmark: '', ordersCount: 1, totalIqd: 0, lastLabel: '', lastDisplayNo: 'EP-2', lastOrderId: null },
    ];
    const queries = ['', '   ', 'علي', 'حسين', 'بغد', 'البصرة', 'الكرادة', 'عنكاوا', 'sara', 'SARA', 'ahmed ', '0770', '07701234567', '٠٧٧٠١٢٣', '۰۷۷۰', '9647701', '+964 770', '770 123', '1234567', '0780', '111', '000', '0', 'EP-261110', 'AB3C', 'x', 'علي 0770'];
    expect(queries.map((q) => `${show(q)} -> [${rows.map((r, i) => (matchesQuery(r, q) ? i : '')).filter((x) => x !== '').join(',')}]`)).toMatchSnapshot();
  });

  it('csvCell / phoneForCsv / csvDate tables', () => {
    const cells: (string | number | null | undefined)[] = ['plain', 'say "hi"', 'a,b', 'line\nbreak', 'cr\rlf', '=SUM(A1)', '+1', '-2', '@cmd', '\tx', '\rx', ' =x', '0', 0, 1_500, -5, 12.5, null, undefined, '', 'بغداد', "'quoted", '=', '"'];
    const phones = ['9647701234567', '07701234567', '+964 770 123 4567', '964770123', '1234567890', '12345678901234567890', '', 'abc'];
    const dates = ['2026-11-10T21:30:00Z', '2026-11-09T20:59:59.999Z', '2026-11-09T21:00:00.000Z', '2026-01-01T00:00:00+03:00', '2026-11-10', 'bad', ''];
    expect({
      BOM: visible(CSV_BOM),
      csvCell: cells.map((c) => `${show(c)} -> ${visible(csvCell(c))}`),
      phoneForCsv: phones.map((p) => `${show(p)} -> ${show(phoneForCsv(p))}`),
      csvDate: dates.map((d) => `${show(d)} -> ${show(csvDate(d))}`),
      emptyTable: visible(customersToCsv(['a', 'b'], [])),
      noHeaders: visible(customersToCsv([], [])),
    }).toMatchSnapshot();
  });
});

/* ───────────────────────── server actions ───────────────────────── */

describe('golden: loginAction / logoutAction', () => {
  it('password check, session cookie (exact token and options), logout', async () => {
    requestHeaders = { 'x-forwarded-for': '203.0.113.5' };
    const rows: string[] = [];
    rows.push(`no password field: ${await outcome(() => loginAction(form({})))}`);
    rows.push(`password is a File: ${await outcome(() => loginAction((() => { const f = new FormData(); f.set('password', new File(['pw-test-1234'], 'p.txt')); return f; })()))}`);
    rows.push(`wrong password: ${await outcome(() => loginAction(form({ password: 'nope' })))}`);
    rows.push(`empty password: ${await outcome(() => loginAction(form({ password: '' })))}`);
    rows.push(`password with extra space: ${await outcome(() => loginAction(form({ password: 'pw-test-1234 ' })))}`);
    rows.push(`cookie after failures: ${jar.has(COOKIE_NAME)}`);
    rows.push(`correct password: ${await outcome(() => loginAction(form({ password: 'pw-test-1234' })))}`);
    const httpCookie = jar.get(COOKIE_NAME);
    requestHeaders = { 'x-forwarded-for': '203.0.113.6', 'x-forwarded-proto': 'https' };
    rows.push(`correct password over https: ${await outcome(() => loginAction(form({ password: 'pw-test-1234' })))}`);
    const httpsCookie = jar.get(COOKIE_NAME);
    rows.push(`logout: ${await outcome(() => logoutAction())}`);
    rows.push(`cookie after logout: ${jar.has(COOKIE_NAME)}`);
    const [h, p] = (httpCookie?.value ?? '').split('.');
    const decode = (part: string) => Buffer.from(part, 'base64url').toString('utf8');
    expect({
      rows,
      cookieName: COOKIE_NAME,
      httpCookieOptions: httpCookie?.options,
      httpsCookieOptions: httpsCookie?.options,
      sameTokenBothTimes: httpCookie?.value === httpsCookie?.value,
      // The token itself is deterministic (HS256, test secret, frozen clock); only its hash is stored.
      tokenParts: (httpCookie?.value ?? '').split('.').length,
      tokenSha256: sha256(httpCookie?.value ?? ''),
      jwtHeader: decode(h ?? ''),
      jwtPayload: decode(p ?? ''),
    }).toMatchSnapshot();
  });

  it('rate limit: 10 attempts per 15 minutes per address; missing admin env', async () => {
    requestHeaders = { 'x-forwarded-for': '203.0.113.7' };
    const results: string[] = [];
    for (let i = 0; i < 10; i++) results.push(await outcome(() => loginAction(form({ password: 'nope' }))));
    const eleventh = await outcome(() => loginAction(form({ password: 'pw-test-1234' })));
    requestHeaders = { 'x-forwarded-for': '203.0.113.8' };
    const otherAddress = await outcome(() => loginAction(form({ password: 'pw-test-1234' })));
    requestHeaders = {};
    const noForwardedHeader = await outcome(() => loginAction(form({ password: 'nope' })));
    vi.setSystemTime(new Date(FROZEN.getTime() + 15 * 60 * 1000));
    requestHeaders = { 'x-forwarded-for': '203.0.113.7' };
    const after15Minutes = await outcome(() => loginAction(form({ password: 'nope' })));
    delete process.env.ADMIN_PASSWORD;
    const noAdminPassword = await outcome(() => loginAction(form({ password: 'pw-test-1234' })));
    process.env.ADMIN_PASSWORD = 'change-me';
    const placeholderPassword = await outcome(() => loginAction(form({ password: 'change-me' })));
    expect({ firstTen: [...new Set(results)], eleventh, otherAddress, noForwardedHeader, after15Minutes, noAdminPassword, placeholderPassword }).toMatchSnapshot();
  });
});

const order = (orderId: string, over: Record<string, unknown> = {}): OrderRecord =>
  ({
    orderId,
    displayNo: 'EP-261110-AB3C',
    createdAt: '2026-11-10T08:00:00.000Z',
    status: 'new',
    spec: { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
    layout: { cols: 6, rows: 9, countPerSheet: 54, rotated: false, turnedCount: 0, cellWidthUm: 30_000, cellHeightUm: 30_000, gapXUm: 2_000, gapYUm: 0 },
    design: { kind: 'png', originalName: 'logo.png', bytes: 3, pxWidth: 900, pxHeight: 900, effectiveDpi: 762 },
    price: { material: 'paper', sheets: 20, unitBaseIqd: 800, discountPercent: 10, unitPriceIqd: 720, subtotalIqd: 14_400, deliveryFeeIqd: 5_000, totalIqd: 19_400, totalStickers: 1_080, perStickerIqd: 18 },
    customer: { name: 'علي', phone: '9647701234567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر' },
    files: { designPath: `uploads/${orderId}.bin`, pdfPath: `orders/${orderId}.pdf` },
    notified: { telegram: 'skipped' },
    ...over,
  }) as OrderRecord;

describe('golden: updateOrderStatus', () => {
  it('auth, validation, update, revalidation', async () => {
    await getStorage().saveOrder(order('order-admin-00001'));
    const rows: string[] = [];
    const status = async () => (await getStorage().getOrder('order-admin-00001'))?.status;
    rows.push(`not logged in: ${await outcome(() => updateOrderStatus(form({ orderId: 'order-admin-00001', status: 'done' })))} | status=${await status()}`);
    await login();
    for (const [label, fields] of [
      ['printing', { orderId: 'order-admin-00001', status: 'printing' }],
      ['done', { orderId: 'order-admin-00001', status: 'done' }],
      ['cancelled', { orderId: 'order-admin-00001', status: 'cancelled' }],
      ['back to new', { orderId: 'order-admin-00001', status: 'new' }],
      ['unknown status', { orderId: 'order-admin-00001', status: 'shipped' }],
      ['status missing', { orderId: 'order-admin-00001' }],
      ['upper-case status', { orderId: 'order-admin-00001', status: 'DONE' }],
      ['bad order id', { orderId: '../../x', status: 'done' }],
      ['order id missing', { status: 'done' }],
      ['unknown but well-formed order id', { orderId: 'order-admin-zzzzz', status: 'done' }],
    ] as [string, Record<string, string>][]) {
      revalidated.length = 0;
      rows.push(`${label}: ${await outcome(() => updateOrderStatus(form(fields)))} | status=${await status()} | revalidated=${canon(revalidated)}`);
    }
    const rest = await getStorage().getOrder('order-admin-00001');
    expect({ rows, nothingElseChanged: canon(rest) === canon(order('order-admin-00001')) }).toMatchSnapshot();
  });
});

/** The fields the settings form submits for DEFAULT_SETTINGS (unchecked checkboxes are absent). */
function settingsForm(over: Record<string, string | null> = {}): FormData {
  const d = DEFAULT_SETTINGS;
  const base: Record<string, string | null> = {
    shopName: d.shopName,
    tagline: d.tagline,
    whatsapp: d.whatsapp,
    phone: d.phone,
    hours: d.hours,
    area: d.area,
    telegramChatId: d.telegramChatId,
    paperPrice: '800',
    paperEnabled: 'on',
    plasticPrice: '1500',
    plasticEnabled: 'on',
    minSheets: '10',
    maxSheets: '5000',
    tiers: JSON.stringify(d.pricing.tiers.map((t) => ({ minSheets: String(t.minSheets), percent: String(t.percent) }))),
    quickPicks: '10,20,50,100',
    deliveryFeeIqd: '5000',
    pricesPublished: 'on',
    margin: '7',
    circleGapX: '2',
    circleGapY: '0',
    roundedGap: '2',
    sharpGap: '0',
    customGap: '2',
    roundedRadius: '3',
    retentionDays: '30',
    allowRotate: null,
  };
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) f.set(k, v);
  return f;
}

/** Leaf-level differences between two settings objects ("path: before -> after"). */
function diff(before: ShopSettings, after: ShopSettings): string[] {
  const flatten = (v: unknown, prefix: string, out: Map<string, string>) => {
    if (Array.isArray(v)) {
      out.set(`${prefix}.length`, String(v.length));
      v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
    else out.set(prefix, show(v));
  };
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, '', a);
  flatten(after, '', b);
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap((k) => (a.get(k) === b.get(k) ? [] : [`${k}: ${a.get(k) ?? '(absent)'} -> ${b.get(k) ?? '(absent)'}`]));
}

describe('golden: saveSettingsAction', () => {
  const tiers = (rows: [string | number, string | number][]) => JSON.stringify(rows.map(([minSheets, percent]) => ({ minSheets, percent })));

  const CASES: [string, Record<string, string | null>][] = [
    ['form unchanged', {}],
    ['shop details; WhatsApp typed with + and spaces', { shopName: '  مطبعة النخيل  ', tagline: 'ستيكرات', whatsapp: '+964 770 999-9999', phone: '0770 999 9999', hours: '9-5', area: 'الكرادة', telegramChatId: ' -100123 ' }],
    ['prices, limits, unsorted tiers, quick picks with Arabic comma', { paperPrice: '1000', plasticPrice: '2000', minSheets: '5', maxSheets: '200', tiers: tiers([['100', '25'], ['10', '5'], [50, 15]]), quickPicks: ' 5، 10 ,50  200 ', deliveryFeeIqd: '0' }],
    ['plastic disabled, prices hidden, rotation on', { plasticEnabled: null, pricesPublished: null, allowRotate: 'on' }],
    ['layout in fractional millimetres', { margin: '7.5', circleGapX: '1.25', circleGapY: '0.5', roundedGap: '3', sharpGap: '1', customGap: '0', roundedRadius: '2.3', retentionDays: '45' }],
    ['no tiers and no quick picks', { tiers: '[]', quickPicks: '' }],
    ['tiers field missing entirely', { tiers: null }],
    ['checkbox value other than "on" counts as unchecked', { plasticEnabled: 'true', pricesPublished: '1', allowRotate: 'yes' }],
    ['both materials disabled', { paperEnabled: null, plasticEnabled: null }],
    ['min above max', { minSheets: '300', maxSheets: '200', quickPicks: '' }],
    ['21 tiers', { tiers: tiers(Array.from({ length: 21 }, (_, i): [string, string] => [String(i + 1), '1'])), quickPicks: '' }],
    ['duplicate tier', { tiers: tiers([['20', '10'], ['20', '15']]) }],
    ['tier percent 91', { tiers: tiers([['20', '91']]) }],
    ['tier percent negative', { tiers: tiers([['20', '-1']]) }],
    ['tier percent fractional', { tiers: tiers([['20', '12.5']]) }],
    ['tier with empty fields', { tiers: tiers([['', '']]) }],
    ['two tiers with empty minSheets', { tiers: tiers([['', '5'], ['', '10']]) }],
    ['tier minSheets 0', { tiers: tiers([['0', '5']]) }],
    ['tiers is not JSON', { tiers: '{nope' }],
    ['tiers is an object', { tiers: '{"minSheets":20}' }],
    ['tiers contains null', { tiers: '[null]' }],
    ['nine quick picks', { quickPicks: '10,11,12,13,14,15,16,17,18' }],
    ['quick pick is not a number', { quickPicks: '10,abc' }],
    ['quick pick fractional', { quickPicks: '10.5' }],
    ['quick pick below the minimum', { quickPicks: '5,10' }],
    ['quick pick above the maximum', { quickPicks: '10,6000' }],
    ['duplicate quick picks are kept', { quickPicks: '10,10,20' }],
    ['paper price empty', { paperPrice: '' }],
    ['paper price fractional', { paperPrice: '800.5' }],
    ['paper price negative', { paperPrice: '-800' }],
    ['price written with Arabic digits', { paperPrice: '٨٠٠' }],
    ['min sheets empty', { minSheets: '' }],
    ['max sheets above the schema limit', { maxSheets: '100001' }],
    ['shop name empty', { shopName: '   ' }],
    ['shop name 81 chars', { shopName: 'x'.repeat(81) }],
    ['WhatsApp 16 digits', { whatsapp: '1234567890123456' }],
    ['delivery fee empty', { deliveryFeeIqd: '' }],
    ['delivery fee fractional', { deliveryFeeIqd: '5000.5' }],
    ['margin not a number', { margin: 'abc' }],
    ['margin empty', { margin: '' }],
    ['margin 51 mm', { margin: '51' }],
    ['margin negative', { margin: '-1' }],
    ['gap with sub-micrometre precision is rounded', { circleGapX: '2.0004' }],
    ['retention 0 days', { retentionDays: '0' }],
    ['retention missing', { retentionDays: null }],
  ];

  it('form -> saved settings (diff from the defaults) or the error shown', async () => {
    const out: Record<string, unknown> = {};
    for (const [label, over] of CASES) {
      freshEnv();
      await login();
      revalidated.length = 0;
      const result = await outcome(() => saveSettingsAction({}, settingsForm(over)));
      const saved = await getStorage().getSettings();
      out[label] = { result, changed: diff(DEFAULT_SETTINGS, saved), revalidated: canon(revalidated) };
    }
    expect(out).toMatchSnapshot();
  });

  it('not logged in; values the form does not carry are preserved; failed save leaves the old settings', async () => {
    const notLoggedIn = await outcome(() => saveSettingsAction({}, settingsForm({ shopName: 'X' })));
    const untouched = canon(await getStorage().getSettings()) === canon(DEFAULT_SETTINGS);
    const stored: ShopSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      shopName: 'قبل',
      layout: { ...DEFAULT_SETTINGS.layout, minSideUm: 6_000 },
      quality: { warnDpi: 120, blockDpi: 60, targetDpi: 360 },
      maxUploadBytes: 5_000_000,
    };
    await getStorage().saveSettings(stored);
    await login();
    const failed = await outcome(() => saveSettingsAction({ error: 'previous' }, settingsForm({ shopName: 'بعد', paperPrice: 'x' })));
    const afterFailure = canon(await getStorage().getSettings()) === canon(stored);
    const ok = await outcome(() => saveSettingsAction({}, settingsForm({ shopName: 'بعد' })));
    expect({ notLoggedIn, untouched, failed, afterFailure, ok, changedFromStored: diff(stored, await getStorage().getSettings()) }).toMatchSnapshot();
  });
});

/* ───────────────────────── GET /api/admin/files/[orderId]/[which] ───────────────────────── */

describe('golden: GET /api/admin/files/[orderId]/[which]', () => {
  const call = (orderId: string, which: string) => filesRoute(new Request(`http://localhost/api/admin/files/${orderId}/${which}`), { params: Promise.resolve({ orderId, which }) });
  const shot = async (label: string, res: Response): Promise<string> => {
    const body = new Uint8Array(await res.arrayBuffer());
    const headers = ['content-type', 'content-length', 'content-disposition', 'cache-control', 'location'].flatMap((n) => (res.headers.get(n) === null ? [] : [`${n}=${res.headers.get(n)}`]));
    const text = res.headers.get('content-type')?.includes('json') ? new TextDecoder().decode(body) : body.byteLength ? `<${body.byteLength} bytes sha ${sha256(body).slice(0, 16)}>` : '(empty body)';
    return `${label} -> ${res.status} [${headers.join('; ')}] ${text}`;
  };

  async function seed(): Promise<void> {
    const s = getStorage();
    const put = async (rec: OrderRecord, design: Uint8Array | null, pdf: Uint8Array | null) => {
      if (design) await s.saveUpload(rec.orderId, design, { mime: 'x', originalName: 'x', bytes: design.byteLength, createdAt: '2026-11-10T08:00:00.000Z' });
      if (pdf) await s.savePdf(rec.orderId, pdf);
      await s.saveOrder(rec);
    };
    const PDF = new TextEncoder().encode('%PDF-1.7 golden');
    await put(order('order-files-00001'), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), PDF);
    await put(order('order-files-00002', { design: { kind: 'jpeg', originalName: 'p.jpg', bytes: 4, pxWidth: 1, pxHeight: 1 }, spec: { shape: 'rect', corners: 'sharp', widthUm: 42_420, heightUm: 30_000 } }), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), PDF);
    await put(order('order-files-00003', { design: { kind: 'pdf', originalName: 'a.pdf', bytes: 5, pxWidth: 1, pxHeight: 1 }, displayNo: 'EP 26/11 "x"<>' }), new TextEncoder().encode('%PDF-'), PDF);
    await put(order('order-files-00004', { price: undefined, offer: { sheets: 10 } }), null, PDF); // legacy record, design already purged
    await put(order('order-files-00005', { price: undefined }), new Uint8Array([1]), null); // no sheets anywhere, PDF missing
  }

  it('auth, parameters, downloads from local storage', async () => {
    await seed();
    const rows: string[] = [];
    rows.push(await shot('not logged in', await call('order-files-00001', 'pdf')));
    await login();
    rows.push(await shot('pdf', await call('order-files-00001', 'pdf')));
    rows.push(await shot('design (png)', await call('order-files-00001', 'design')));
    rows.push(await shot('pdf of a 4.24x3 cm rect', await call('order-files-00002', 'pdf')));
    rows.push(await shot('design (jpeg -> .jpg)', await call('order-files-00002', 'design')));
    rows.push(await shot('pdf, display number with unsafe characters', await call('order-files-00003', 'pdf')));
    rows.push(await shot('design (pdf), display number with unsafe characters', await call('order-files-00003', 'design')));
    rows.push(await shot('legacy order: sheets from offer', await call('order-files-00004', 'pdf')));
    rows.push(await shot('legacy order: design file is gone', await call('order-files-00004', 'design')));
    rows.push(await shot('no sheets anywhere: pdf file is gone', await call('order-files-00005', 'pdf')));
    rows.push(await shot('no sheets anywhere: design', await call('order-files-00005', 'design')));
    rows.push(await shot('unknown order', await call('order-files-zzzzz', 'pdf')));
    rows.push(await shot('bad order id', await call('../../settings', 'pdf')));
    rows.push(await shot('unknown file kind', await call('order-files-00001', 'json')));
    rows.push(await shot('upper-case kind', await call('order-files-00001', 'PDF')));
    expect(rows).toMatchSnapshot();
  });

  it('cloud storage: 302 to a 60-second signed link', async () => {
    await seed();
    await login();
    const real = getStorage();
    const asked: unknown[][] = [];
    let answer: string | null = 'https://sb.example/storage/v1/object/sign/etihad/x?token=t&download=name';
    fake = new Proxy(real, {
      get: (target, prop, receiver) => {
        if (prop === 'signedDownloadUrl')
          return async (...args: unknown[]) => {
            asked.push(args);
            return answer;
          };
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const rows = [await shot('pdf', await call('order-files-00001', 'pdf')), await shot('design with unsafe display number', await call('order-files-00003', 'design'))];
    answer = null;
    rows.push(await shot('no signed link (object missing)', await call('order-files-00001', 'pdf')));
    fake = null;
    expect({ rows, signedDownloadUrlArguments: asked }).toMatchSnapshot();
  });
});
