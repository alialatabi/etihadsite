/**
 * GOLDEN (extra, not in the original list) — src/lib/storage/supabase.ts, the adapter the
 * hosted site runs on. fetch is stubbed (the pattern of tests/unit/server/supabase-storage.test.ts);
 * nothing leaves the machine. Pinned per adapter method: the exact HTTP requests (method,
 * path + query, headers, body, timeout) and what the method returns for canned answers.
 *
 * Masked: the secret key never appears — each request line only says `auth=ok` when both
 * `apikey` and `Authorization: Bearer <key>` carry it. Date is frozen at 2026-11-10T09:00:00Z
 * (saveSettings stamps `updated_at`; purgeOlderThan derives its orphan cutoff from the clock).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { SUPABASE_MAX_UPLOAD_BYTES, SupabaseStorage } from '@/lib/storage/supabase';
import type { AnalyticsEvent, OrderRecord, StoredFileMeta } from '@/lib/types';
import { canon, sha16, sha256, show, visible } from './_util';

const BASE = 'https://proj.supabase.co';
const KEY = 'golden-secret-key-not-real';
const ID = 'abcDEF_123-xyz';
const FROZEN = new Date('2026-11-10T09:00:00.000Z');

let requests: string[] = [];
let queue: (Response | Error)[] = [];
let timeouts: number[] = [];

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const bytes = (b: Uint8Array, status = 200) => new Response(b as BodyInit, { status });
const empty = (status = 200) => new Response(status === 204 ? null : '', { status });

function bodyText(body: unknown): string {
  if (body === undefined || body === null) return '(none)';
  if (typeof body === 'string') return body.length > 600 ? `${visible(body.slice(0, 120))}… (${body.length} chars, sha ${sha16(body)})` : visible(body);
  if (body instanceof Uint8Array) return `<binary ${body.byteLength} bytes sha ${sha16(body)}>`;
  return `<${Object.prototype.toString.call(body)}>`;
}

beforeEach(() => {
  vi.setSystemTime(FROZEN);
  requests = [];
  queue = [];
  timeouts = [];
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    timeouts.push(ms);
    return realTimeout(ms);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: RequestInit & { headers?: Record<string, string> } = {}) => {
      const headers = { ...(init.headers ?? {}) };
      const auth = headers.apikey === KEY && headers.Authorization === `Bearer ${KEY}` ? 'ok' : 'MISSING';
      delete headers.apikey;
      delete headers.Authorization;
      const extra = Object.keys(init)
        .filter((k) => !['method', 'headers', 'body', 'cache', 'signal'].includes(k))
        .sort();
      requests.push(
        `${init.method ?? 'GET'} ${String(url).replace(BASE, '')} | auth=${auth} cache=${String(init.cache)} timeout=${timeouts[timeouts.length - 1]}ms headers=${canon(headers)}` +
          `${extra.length ? ` extraInit=${extra.join(',')}` : ''} | body=${bodyText(init.body)}`,
      );
      const next = queue.shift();
      if (!next) throw new Error(`unexpected fetch ${String(url)}`);
      if (next instanceof Error) throw next;
      return next;
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const store = () => new SupabaseStorage(`${BASE}///`, KEY);

/** Runs one adapter call against canned responses; returns its requests and outcome. */
async function run<T>(responses: (Response | Error)[], call: (s: SupabaseStorage) => Promise<T>, describeResult: (r: T) => unknown = (r) => r) {
  requests = [];
  queue = [...responses];
  let result: unknown;
  try {
    result = describeResult(await call(store()));
  } catch (e) {
    result = `THROWS ${visible((e as Error).message)}`;
  }
  return { requests: [...requests], result, unusedResponses: queue.length };
}

const META: StoredFileMeta = { mime: 'image/png', originalName: 'شعار.png', bytes: 3, createdAt: '2026-11-10T08:00:00.000Z' };

const record = (orderId = ID): OrderRecord => ({
  orderId,
  displayNo: 'EP-261110-AB3C',
  createdAt: '2026-11-10T08:30:00.000Z',
  status: 'new',
  spec: { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
  layout: { cols: 6, rows: 9, countPerSheet: 54, rotated: false, turnedCount: 0, cellWidthUm: 30_000, cellHeightUm: 30_000, gapXUm: 2_000, gapYUm: 0 },
  design: { kind: 'png', originalName: 'logo.png', bytes: 3, pxWidth: 900, pxHeight: 900, effectiveDpi: 762 },
  price: { material: 'paper', sheets: 20, unitBaseIqd: 800, discountPercent: 10, unitPriceIqd: 720, subtotalIqd: 14_400, deliveryFeeIqd: 5_000, totalIqd: 19_400, totalStickers: 1_080, perStickerIqd: 18 },
  customer: { name: 'علي', phone: '9647701234567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر' },
  files: { designPath: `uploads/${ID}.bin`, pdfPath: `orders/${orderId}.pdf` },
  notified: { telegram: 'skipped' },
});

const u8 = (r: Uint8Array | null) => (r ? Array.from(r) : null);

describe('golden: SupabaseStorage — objects', () => {
  it('constants', () => {
    expect({ SUPABASE_MAX_UPLOAD_BYTES, directUploadMaxBytes: store().directUploadMaxBytes }).toMatchSnapshot();
  });

  it('uploads, PDFs, read, delete', async () => {
    const metaBytes = new TextEncoder().encode(JSON.stringify(META));
    expect({
      saveUpload: await run([empty(), empty()], (s) => s.saveUpload(ID, new Uint8Array([1, 2, 3]), META)),
      saveUploadMeta: await run([empty()], (s) => s.saveUploadMeta(ID, META)),
      savePdf: await run([empty()], (s) => s.savePdf(ID, new Uint8Array([0x25, 0x50, 0x44, 0x46]))),
      readUpload: await run([bytes(metaBytes), bytes(new Uint8Array([1, 2, 3]))], (s) => s.readUpload(ID), (r) => (r ? { bytes: u8(r.bytes), meta: r.meta } : null)),
      readUploadNoMeta: await run([empty(404)], (s) => s.readUpload(ID)),
      readUploadMetaButNoBin: await run([bytes(metaBytes), json({ statusCode: '404', error: 'not_found' }, 400)], (s) => s.readUpload(ID)),
      readUploadCorruptMeta: await run([bytes(new TextEncoder().encode('{torn')), bytes(new Uint8Array([1]))], (s) => s.readUpload(ID)),
      readFile: await run([bytes(new Uint8Array([7, 8, 9]))], (s) => s.readFile(`orders/${ID}.pdf`), u8),
      readFile404: await run([empty(404)], (s) => s.readFile(`orders/${ID}.pdf`), u8),
      readFile400NotFoundBody: await run([json({ statusCode: 404 }, 400)], (s) => s.readFile(`orders/${ID}.pdf`), u8),
      readFile400Other: await run([json({ statusCode: '500', message: 'boom' }, 400)], (s) => s.readFile(`orders/${ID}.pdf`), u8),
      deleteFile: await run([json([])], (s) => s.deleteFile(`uploads/${ID}.bin`)),
    }).toMatchSnapshot();
  });

  it('signed URLs', async () => {
    expect({
      createDirectUpload: await run([json({ url: `/object/upload/sign/etihad/uploads/${ID}.bin?token=tok` })], (s) => s.createDirectUpload(ID)),
      createDirectUploadBadAnswer: await run([json({ url: 'https://evil.example/x?token=tok' })], (s) => s.createDirectUpload(ID)),
      createDirectUploadNoToken: await run([json({ url: `/object/upload/sign/etihad/uploads/${ID}.bin` })], (s) => s.createDirectUpload(ID)),
      signedDownloadUrl: await run([json({ signedURL: `/object/sign/etihad/orders/${ID}.pdf?token=tok` })], (s) => s.signedDownloadUrl(`orders/${ID}.pdf`, 'EP-261110-AB3C_circle-30x30mm_x20.pdf')),
      signedDownloadUrlArabicNameAndTtl: await run([json({ signedURL: `/object/sign/etihad/uploads/${ID}.bin?token=tok` })], (s) => s.signedDownloadUrl(`uploads/${ID}.bin`, 'شعار نهائي.png', 300)),
      signedDownloadUrlNotFound: await run([empty(404)], (s) => s.signedDownloadUrl(`orders/${ID}.pdf`, 'a.pdf')),
      signedDownloadUrlMalformed: await run([json({ signedURL: '/other/path?token=tok' })], (s) => s.signedDownloadUrl(`orders/${ID}.pdf`, 'a.pdf')),
    }).toMatchSnapshot();
  });

  it('invalid ids and paths never reach the network', async () => {
    const rows: string[] = [];
    const t = async (label: string, call: (s: SupabaseStorage) => Promise<unknown>) => {
      const r = await run([], call);
      rows.push(`${label} -> ${show(r.result)} (requests: ${r.requests.length})`);
    };
    for (const id of ['short', '../../etc/passwd', 'has space 123', 'a'.repeat(65)]) {
      const shown = id.length > 20 ? `${id.slice(0, 6)}…(${id.length})` : id;
      await t(`saveUpload(${shown})`, (s) => s.saveUpload(id, new Uint8Array([1]), META));
      await t(`saveUploadMeta(${shown})`, (s) => s.saveUploadMeta(id, META));
      await t(`savePdf(${shown})`, (s) => s.savePdf(id, new Uint8Array([1])));
      await t(`readUpload(${shown})`, (s) => s.readUpload(id));
      await t(`createDirectUpload(${shown})`, (s) => s.createDirectUpload(id));
      await t(`saveOrder(${shown})`, (s) => s.saveOrder(record(id)));
      await t(`getOrder(${shown})`, (s) => s.getOrder(id));
      await t(`updateOrder(${shown})`, (s) => s.updateOrder(id, { status: 'done' }));
    }
    for (const rel of ['settings.json', 'uploads/../x.bin', '/uploads/abcdefgh.bin', 'uploads/abcdefgh.exe', 'uploads/abc.bin', 'other/abcdefgh.bin', 'uploads/abcdefgh.bin?x=1', 'uploads\\abcdefgh.bin', '']) {
      await t(`readFile(${show(rel)})`, (s) => s.readFile(rel));
      await t(`deleteFile(${show(rel)})`, (s) => s.deleteFile(rel));
      await t(`signedDownloadUrl(${show(rel)})`, (s) => s.signedDownloadUrl(rel, 'a.pdf'));
    }
    expect(rows).toMatchSnapshot();
  });
});

describe('golden: SupabaseStorage — orders and settings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('orders', async () => {
    const rec = record();
    const recordBody = JSON.stringify({ order_id: rec.orderId, created_at: rec.createdAt, record: rec });
    const save = await run([empty(201)], (s) => s.saveOrder(rec));
    expect({
      // The body is long, so the request line shows its head and a hash; the hash is compared with the expected JSON here.
      saveOrder: { ...save, bodyIsOrderIdCreatedAtRecord: save.requests[0].includes(`sha ${sha16(recordBody)}`), bodySha256: sha256(recordBody) },
      getOrder: await run([json([{ record: rec }])], (s) => s.getOrder(ID), (r) => canon(r) === canon(rec)),
      getOrderMissing: await run([json([])], (s) => s.getOrder(ID)),
      getOrderOddId: await run([json([])], (s) => s.getOrder('id_with-dash_AND_underscore')),
      listOrders: await run([json([{ record: record('order-0000002') }, { record: record('order-0000001') }])], (s) => s.listOrders(), (r) => r.map((o) => o.orderId)),
      updateStatus: await run([json({ ...rec, status: 'printing' })], (s) => s.updateOrder(ID, { status: 'printing' }), (r) => r?.status),
      updateNotified: await run([json({ ...rec, notified: { telegram: 'sent' } })], (s) => s.updateOrder(ID, { notified: { telegram: 'sent' } }), (r) => r?.notified),
      updateBoth: await run([json(rec)], (s) => s.updateOrder(ID, { status: 'done', notified: { telegram: 'failed' } }), (r) => r?.orderId),
      updateExtraKeysAreDropped: await run([json(rec)], (s) => s.updateOrder(ID, { status: 'done', displayNo: 'HACKED' } as never), (r) => r?.orderId),
      updateEmptyPatch: await run([json(rec)], (s) => s.updateOrder(ID, {}), (r) => r?.orderId),
      updateUnknownOrder: await run([json(null)], (s) => s.updateOrder(ID, { status: 'done' })),
    }).toMatchSnapshot();
  });

  it('settings', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const diff = (s: unknown) => {
      const a = s as Record<string, unknown>;
      const d = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
      return Object.keys({ ...d, ...a })
        .filter((k) => canon(a[k]) !== canon(d[k]))
        .map((k) => `${k}: ${canon(a[k])}`);
    };
    const custom = { ...structuredClone(DEFAULT_SETTINGS), shopName: 'مطبعة', whatsapp: '9647709999999' };
    const out = {
      noRow: await run([json([])], (s) => s.getSettings(), diff),
      partialRow: await run([json([{ data: { shopName: 'مطبعة تجريبية', deliveryFeeIqd: 3_000, pricing: { minSheets: 5, tiers: [{ minSheets: 200, percent: 30 }, { minSheets: 30, percent: 5 }] }, offers: [{ id: 1 }] } }])], (s) => s.getSettings(), diff),
      legacyRow: await run([json([{ data: { shopName: 'الاتحاد برنت', offers: [{ id: 'o1', sheets: 10, priceIqd: 25_000 }], pricesPublished: false } }])], (s) => s.getSettings(), diff),
      invalidRow: await run([json([{ data: { deliveryFeeIqd: -5, whatsapp: '+964' } }])], (s) => s.getSettings(), diff),
      nullData: await run([json([{ data: null }])], (s) => s.getSettings(), diff),
      outage: await run([empty(503)], (s) => s.getSettings(), diff),
      saveSettings: await run([empty(201)], (s) => s.saveSettings(custom)),
    };
    const saveBody = JSON.stringify({ id: 1, data: custom, updated_at: FROZEN.toISOString() });
    expect({ ...out, saveSettingsBodyIsIdDataUpdatedAt: out.saveSettings.requests[0].includes(`sha ${sha16(saveBody)}`), logged: err.mock.calls.map((c) => c.map(String)) }).toMatchSnapshot();
  });
});

describe('golden: SupabaseStorage — analytics and customers', () => {
  it('events', async () => {
    const full: AnalyticsEvent = { ts: '2026-11-10T08:00:00.000Z', type: 'order', visitor: 'v1', path: '/', step: 'details', source: 'instagram', device: 'mobile', city: 'Baghdad', region: 'BG', country: 'IQ', meta: { material: 'paper', sheets: 20, totalIqd: 19_400 } };
    const row = (i: number) => ({ ts: `2026-11-10T08:${String(i % 60).padStart(2, '0')}:00.000Z`, type: 'pageview', visitor: `v${i}`, path: '/', step: null, source: null, device: 'mobile', city: null, region: null, country: null, meta: null });
    const page1 = Array.from({ length: 1_000 }, (_, i) => row(i));
    const page2 = [row(1_000), row(1_001)];
    expect({
      recordFull: await run([empty(201)], (s) => s.recordEvent(full)),
      recordMinimal: await run([empty(201)], (s) => s.recordEvent({ ts: '2026-11-10T08:00:00.000Z', type: 'pageview', visitor: 'v1' })),
      listOnePage: await run([json([row(1), { ...row(2), source: 'google', meta: { kind: 'png' } }])], (s) => s.listEvents(new Date('2026-10-01T00:00:00.000Z')), (r) => r.map((e) => canon(e))),
      listTwoPages: await run([json(page1), json(page2)], (s) => s.listEvents(new Date('2026-10-01T00:00:00.000Z')), (r) => `${r.length} events, first keys=[${Object.keys(r[0]).join(',')}]`),
      listExactlyOnePageThenEmpty: await run([json(page1), json([])], (s) => s.listEvents(new Date('2026-10-01T00:00:00.000Z')), (r) => r.length),
      purgeDry: await run([json([{ id: 1 }, { id: 2 }, { id: 3 }])], (s) => s.purgeEventsOlderThan(new Date('2025-10-06T09:00:00.000Z'), true)),
      purgeDryNone: await run([json([])], (s) => s.purgeEventsOlderThan(new Date('2025-10-06T09:00:00.000Z'), true)),
      purgeReal: await run([json([{ id: 1 }, { id: 2 }])], (s) => s.purgeEventsOlderThan(new Date('2025-10-06T09:00:00.000Z'), false)),
      purgeRealEmptyBody: await run([empty(200)], (s) => s.purgeEventsOlderThan(new Date('2025-10-06T09:00:00.000Z'), false)),
    }).toMatchSnapshot();
  });

  it('customers', async () => {
    const dbRow = (i: number, name: string | null) => ({ phone: `96477000000${String(i).padStart(2, '0')}`, name, governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر', first_order_at: '2026-11-01T09:00:00+00:00', last_order_at: '2026-11-10T09:00:00+00:00', orders_count: i + 1, total_iqd: '19400', last_order_id: `order-${i}`, last_display_no: `EP-${i}`, created_at: 'x', extra_column: 1 });
    const page1 = Array.from({ length: 1_000 }, (_, i) => dbRow(i % 100, 'x'));
    expect({
      upsert: await run([empty(204)], (s) => s.upsertCustomerFromOrder(record())),
      upsertNoNameUnpriced: await run([empty(204)], (s) => s.upsertCustomerFromOrder({ ...record(), customer: { phone: '9647801112222', governorate: 'البصرة', district: '', landmark: 'x' }, price: { ...record().price, totalIqd: null } })),
      list: await run([json([dbRow(1, 'علي'), dbRow(2, null), dbRow(3, '')])], (s) => s.listCustomers(), (r) => r.map((c) => `keys=[${Object.keys(c).join(',')}] ${canon(c)}`)),
      listTwoPages: await run([json(page1), json([dbRow(5, 'y')])], (s) => s.listCustomers(), (r) => r.length),
    }).toMatchSnapshot();
  });
});

describe('golden: SupabaseStorage — retention purge and failures', () => {
  const cutoff = new Date('2026-10-11T09:00:00.000Z');
  const responses = () => [
    // old orders
    json([
      { order_id: 'order-old-0001', files: { designPath: 'uploads/upload-old-0001.bin', pdfPath: 'orders/order-old-0001.pdf' } },
      { order_id: 'order-old-0002', files: { designPath: 'uploads/upload-shared-01.bin', pdfPath: 'orders/order-old-0002.pdf' } },
      { order_id: 'order-old-0003', files: null },
      { order_id: 'order-old-0004', files: { designPath: '../evil.bin', pdfPath: 'orders/../../evil.pdf' } },
    ]),
    // designs still used by kept orders
    json([{ design: 'uploads/upload-shared-01.bin' }, { design: null }, { design: 'uploads/upload-new-0001.bin' }]),
    // bucket listing of uploads/
    json([
      { name: 'upload-old-0001.bin', created_at: '2026-09-01T00:00:00.000Z' },
      { name: 'upload-old-0001.json', created_at: '2026-09-01T00:00:00.000Z' },
      { name: 'upload-shared-01.bin', created_at: '2026-09-01T00:00:00.000Z' },
      { name: 'upload-shared-01.json', created_at: '2026-09-01T00:00:00.000Z' },
      { name: 'upload-new-0001.bin', created_at: '2026-11-09T00:00:00.000Z' },
      { name: 'upload-new-0001.json', created_at: '2026-11-09T00:00:00.000Z' },
      { name: 'upload-orphan-old.bin', created_at: '2026-09-15T00:00:00.000Z' },
      { name: 'upload-orphan-old.json', created_at: '2026-09-15T00:00:00.000Z' },
      { name: 'upload-uncommitted-4h.bin', created_at: '2026-11-10T05:00:00.000Z' }, // no .json, older than 3 h
      { name: 'upload-uncommitted-1h.bin', created_at: '2026-11-10T08:00:00.000Z' }, // no .json, younger than 3 h
      { name: 'upload-fresh-0001.bin', created_at: '2026-11-10T05:00:00.000Z' },
      { name: 'upload-fresh-0001.json', created_at: '2026-11-10T05:00:01.000Z' },
      { name: 'upload-metaonly-01.json', created_at: '2026-09-01T00:00:00.000Z' }, // bin already gone
      { name: 'upload-nodate-001.bin' },
      { name: 'bad name.bin', created_at: '2026-01-01T00:00:00.000Z' },
      { name: '.emptyFolderPlaceholder', created_at: '2026-01-01T00:00:00.000Z' },
    ]),
  ];

  it('purgeOlderThan: dry run and real run', async () => {
    const dry = await run(responses(), (s) => s.purgeOlderThan(cutoff, true));
    const real = await run([...responses(), json([]), empty(204)], (s) => s.purgeOlderThan(cutoff, false));
    const explicitOrphanCutoff = await run(responses(), (s) => s.purgeOlderThan(cutoff, true, new Date('2026-11-10T08:30:00.000Z')), (r) => r.filter((p) => p.includes('uncommitted')));
    const nothingOld = await run([json([]), json([]), json([])], (s) => s.purgeOlderThan(cutoff, false));
    expect({ dry, real, explicitOrphanCutoff, nothingOld }).toMatchSnapshot();
  });

  it('non-2xx answers and network errors throw (message format)', async () => {
    expect({
      http500: await run([new Response('internal error '.repeat(40), { status: 500 })], (s) => s.getOrder(ID)),
      http401Json: await run([json({ message: 'Invalid API key' }, 401)], (s) => s.listOrders()),
      http404OnTable: await run([empty(404)], (s) => s.getOrder(ID)),
      post409: await run([json({ code: '23505' }, 409)], (s) => s.saveOrder(record())),
      queryStringIsNotInTheMessage: await run([empty(500)], (s) => s.listEvents(new Date('2026-10-01T00:00:00.000Z'))),
      network: await run([new Error('fetch failed')], (s) => s.getSettings()),
      uploadFailsOnTheSecondObject: await run([empty(), empty(500)], (s) => s.saveUpload(ID, new Uint8Array([1]), META)),
    }).toMatchSnapshot();
  });
});
