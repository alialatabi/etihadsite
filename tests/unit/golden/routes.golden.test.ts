/**
 * GOLDEN — HTTP route handlers, called directly with Request objects against a fresh
 * local DATA_DIR per test (the pattern of tests/unit/server/*-route.test.ts), with the REAL
 * layout / sharp / pdf-lib / pricing / storage pipeline behind them.
 *
 *   POST /api/orders · POST /api/upload · POST /api/upload/direct · POST /api/upload/direct/commit
 *   POST /api/track · POST /api/log · GET /api/cron/purge · GET /api/admin/customers
 *
 * Determinism:
 *  - Date is FROZEN at 2026-11-10T09:00:00.000Z (12:00 in Baghdad), so createdAt/ts, the
 *    date part of the display number, Retry-After and the purge cutoff are real values.
 *  - Masked, because they are random by design:
 *      upload ids (nanoid)                -> <UPLOAD_ID>
 *      display-number suffix (4 chars)    -> EP-261110-<RAND>
 *      PDF size in the console transport  -> (<N> bytes)   (it varies with the suffix)
 *  - The temp DATA_DIR never appears: only paths relative to it are snapshotted.
 *  - Order ids are chosen by the client, so they are fixed inputs here, not masked.
 *
 * `next/headers` is mocked with a cookie jar (as tests/unit/server/session.test.ts does) for
 * the admin CSV route; `@/lib/storage` is wrapped so single tests can swap in a fake
 * direct-upload adapter (as tests/unit/server/upload-direct-route.test.ts does).
 */
import { readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { AnalyticsEvent, OrderRecord, ShopSettings, StorageAdapter, StoredFileMeta } from '@/lib/types';
import { SECRET, setupEnv } from '../server/helpers';
import { removeTempDirs, sha256, track, visible } from './_util';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) as string } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));

/** null -> the real getStorage() (local disk under the test's DATA_DIR). */
let fake: StorageAdapter | null = null;
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { getStorage: () => fake ?? actual.getStorage() };
});

import { GET as customersCsv } from '@/app/api/admin/customers/route';
import { GET as cronPurge } from '@/app/api/cron/purge/route';
import { POST as logRoute } from '@/app/api/log/route';
import { POST as ordersRoute } from '@/app/api/orders/route';
import { POST as trackRoute } from '@/app/api/track/route';
import { POST as directCommit } from '@/app/api/upload/direct/commit/route';
import { POST as directStart } from '@/app/api/upload/direct/route';
import { POST as uploadRoute } from '@/app/api/upload/route';
import { COOKIE_NAME, signToken } from '@/lib/auth/token';
import { getStorage } from '@/lib/storage';

const FROZEN = new Date('2026-11-10T09:00:00.000Z');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const fx = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, '..', '..', 'fixtures', name)));
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);

let dataDir = '';
let ipSeq = 0;
/** A fresh client address per call so the per-IP limiters never interfere unless a test wants them to. */
const nextIp = () => `198.51.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeEach(() => {
  vi.setSystemTime(FROZEN);
  dataDir = track(setupEnv());
  delete process.env.STORAGE;
  delete process.env.CRON_SECRET;
  fake = null;
  jar.clear();
  (globalThis as { __epTrackLimiter?: unknown }).__epTrackLimiter = undefined;
});

afterEach(() => {
  fake = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(removeTempDirs);

/* ───────────────────────── helpers ───────────────────────── */

const SHOWN_HEADERS = ['content-type', 'retry-after', 'cache-control', 'content-disposition'];

function mask(text: string, uploadIds: string[] = []): string {
  let t = text;
  for (const id of uploadIds) t = t.replaceAll(id, '<UPLOAD_ID>');
  return t.replace(/EP-(\d{6})-[2-9A-HJ-NP-Z]{4}/g, 'EP-$1-<RAND>');
}

/** "label -> status [headers] body" on one line. */
async function line(label: string, res: Response, uploadIds: string[] = []): Promise<string> {
  const text = await res.text();
  const headers = SHOWN_HEADERS.flatMap((n) => (res.headers.get(n) === null ? [] : [`${n}=${res.headers.get(n)}`]));
  return `${label} -> ${res.status} [${headers.join('; ')}] ${text === '' ? '(empty body)' : visible(mask(text, uploadIds))}`;
}

/** Every file under DATA_DIR as sorted POSIX-style relative paths. */
function tree(root: string = dataDir): string[] {
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

const readText = (rel: string): string => readFileSync(path.join(dataDir, rel), 'utf8');
const eventLines = (rel = 'analytics/events-2026-11.jsonl'): string[] => {
  try {
    return readText(rel).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), 'user-agent': UA, ...headers },
    body: raw,
  });
}

const orderReq = (body: unknown, headers: Record<string, string> = {}) => jsonReq('http://localhost/api/orders', body, headers);

/** Multipart upload request with a real Content-Length (as browsers send). */
async function uploadReq(form: FormData, headers: Record<string, string> = {}, contentLength: string | null | undefined = undefined): Promise<Request> {
  const encoded = new Response(form);
  const raw = new Uint8Array(await encoded.arrayBuffer());
  const h: Record<string, string> = { 'x-forwarded-for': nextIp(), 'user-agent': UA, 'content-type': encoded.headers.get('content-type') ?? '', ...headers };
  if (contentLength === undefined) h['content-length'] = String(raw.byteLength);
  else if (contentLength !== null) h['content-length'] = contentLength;
  return new Request('http://localhost/api/upload', { method: 'POST', body: raw, headers: h });
}

function fileForm(bytes: Uint8Array, name: string, type = 'application/octet-stream'): FormData {
  const form = new FormData();
  form.set('file', new File([bytes as BlobPart], name, { type }));
  return form;
}

const customerBody = (over: Record<string, unknown> = {}) => ({
  name: 'علي حسين',
  phone: '٠٧٧٠ ١٢٣ ٤٥٦٧',
  governorate: 'بغداد',
  district: 'الكرادة',
  landmark: 'قرب الجسر المعلق',
  ...over,
});

const orderBody = (over: Record<string, unknown> = {}) => ({
  orderId: 'order-golden-aaaaaaaaaa',
  uploadId: 'upload-png-0000000001',
  spec: { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
  material: 'paper',
  sheets: 20,
  customer: customerBody(),
  ...over,
});

const META = (name: string, bytes: number, mime = 'image/png'): StoredFileMeta => ({ mime, originalName: name, bytes, createdAt: '2026-11-10T08:00:00.000Z' });

async function seedUploads(): Promise<void> {
  const s = getStorage();
  const put = (id: string, bytes: Uint8Array, name: string, mime: string) => s.saveUpload(id, bytes, META(name, bytes.byteLength, mime));
  await put('upload-png-0000000001', fx('padded-400x400.png'), 'padded.png', 'image/png');
  await put('upload-jpg-0000000001', fx('opaque-300x300.jpg'), 'opaque.jpg', 'image/jpeg');
  await put('upload-exif-000000001', fx('exif6-600x400.jpg'), 'exif.jpg', 'image/jpeg');
  await put('upload-pdf-0000000001', fx('cropbox-rot90.pdf'), 'art.pdf', 'application/pdf');
  await put('upload-badpng-00000001', new Uint8Array([...PNG_SIG, 1, 2, 3]), 'broken.png', 'image/png');
  await put('upload-encpdf-00000001', fx('encrypted-marker.pdf'), 'locked.pdf', 'application/pdf');
  await put('upload-badpdf-00000001', new TextEncoder().encode('%PDF-1.7\nnot really a pdf\n%%EOF'), 'broken.pdf', 'application/pdf');
  await put('upload-gif-0000000001', GIF, 'anim.gif', 'image/png');
}

/** Storage that fails on first use: every route must answer with its own server_error shape. */
const brokenStorage = (): StorageAdapter =>
  new Proxy({} as StorageAdapter, {
    get: (_t, prop) => {
      if (prop === 'createDirectUpload') return async () => 'https://unused.example';
      return async () => {
        throw new Error(`GOLDEN storage down (${String(prop)})`);
      };
    },
  });

/* ───────────────────────── POST /api/orders: rejections ───────────────────────── */

describe('golden: POST /api/orders — rejected requests', () => {
  it('status + JSON for malformed bodies, schema failures and every pipeline error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedUploads();
    // plastic disabled so that "material_disabled" is reachable; everything else is default.
    await getStorage().saveSettings({
      ...DEFAULT_SETTINGS,
      pricing: { ...DEFAULT_SETTINGS.pricing, materials: { ...DEFAULT_SETTINGS.pricing.materials, plastic: { enabled: false, pricePerSheetIqd: 1_500 } } },
    });
    const big = JSON.stringify({ ...orderBody(), pad: 'a'.repeat(65 * 1024) });
    let n = 0;
    const id = () => `order-reject-${String(n++).padStart(8, '0')}`;
    const withOrder = (over: Record<string, unknown>) => orderBody({ orderId: id(), ...over });

    const cases: [string, () => Request][] = [
      // body / JSON level
      ['not JSON', () => orderReq('{nope')],
      ['empty body', () => orderReq('')],
      ['JSON null', () => orderReq('null')],
      ['JSON array', () => orderReq('[]')],
      ['empty object', () => orderReq({})],
      ['declared Content-Length over 64 KiB', () => orderReq(big, { 'content-length': String(new TextEncoder().encode(big).byteLength) })],
      ['body over 64 KiB without Content-Length', () => orderReq(big)],
      ['body exactly 64 KiB of padding around an invalid order', () => orderReq(JSON.stringify({ pad: 'a'.repeat(64 * 1024 - 10) }))],
      // schema level
      ['orderId too short', () => orderReq(withOrder({ orderId: 'short' }))],
      ['orderId with path characters', () => orderReq(withOrder({ orderId: '../../etc/passwd' }))],
      ['circle that is not square', () => orderReq(withOrder({ spec: { shape: 'circle', widthUm: 30_000, heightUm: 40_000 } }))],
      ['unknown shape', () => orderReq(withOrder({ spec: { shape: 'star', widthUm: 30_000, heightUm: 30_000 } }))],
      ['fractional size', () => orderReq(withOrder({ spec: { shape: 'rect', widthUm: 30_000.5, heightUm: 30_000 } }))],
      ['size above 400 mm', () => orderReq(withOrder({ spec: { shape: 'rect', widthUm: 400_001, heightUm: 30_000 } }))],
      ['unknown material', () => orderReq(withOrder({ material: 'gold' }))],
      ['fractional sheets', () => orderReq(withOrder({ sheets: 10.5 }))],
      ['sheets as a string', () => orderReq(withOrder({ sheets: '20' }))],
      ['missing customer', () => orderReq(withOrder({ customer: undefined }))],
      ['landmark blank', () => orderReq(withOrder({ customer: customerBody({ landmark: '   ' }) }))],
      ['governorate missing', () => orderReq(withOrder({ customer: customerBody({ governorate: undefined }) }))],
      // pipeline level (order of checks: phone -> quantity -> upload -> layout -> artwork)
      ['phone that is not Iraqi mobile', () => orderReq(withOrder({ customer: customerBody({ phone: '12345' }) }))],
      ['landline-looking phone', () => orderReq(withOrder({ customer: customerBody({ phone: '06701234567' }) }))],
      ['bad phone AND bad quantity AND missing upload -> phone wins', () => orderReq(withOrder({ customer: customerBody({ phone: '12345' }), sheets: 1, uploadId: 'upload-missing-000001' }))],
      ['sheets below the minimum (9)', () => orderReq(withOrder({ sheets: 9 }))],
      ['sheets above the maximum (5001)', () => orderReq(withOrder({ sheets: 5_001 }))],
      ['disabled material', () => orderReq(withOrder({ material: 'plastic' }))],
      ['bad quantity AND missing upload -> quantity wins', () => orderReq(withOrder({ sheets: 9, uploadId: 'upload-missing-000001' }))],
      ['upload id that does not exist', () => orderReq(withOrder({ uploadId: 'upload-missing-000001' }))],
      ['missing upload AND too-small size -> upload wins', () => orderReq(withOrder({ uploadId: 'upload-missing-000001', spec: { shape: 'circle', widthUm: 4_000, heightUm: 4_000 } }))],
      ['circle 4 mm (below the 5 mm minimum)', () => orderReq(withOrder({ spec: { shape: 'circle', widthUm: 4_000, heightUm: 4_000 } }))],
      ['rect 300x300 mm (larger than the page)', () => orderReq(withOrder({ spec: { shape: 'rect', corners: 'sharp', widthUm: 300_000, heightUm: 300_000 } }))],
      ['rect 250x50 mm (fits only rotated; rotation is off)', () => orderReq(withOrder({ spec: { shape: 'rect', corners: 'sharp', widthUm: 250_000, heightUm: 50_000 } }))],
      ['too-big size AND corrupt upload -> layout wins', () => orderReq(withOrder({ uploadId: 'upload-badpng-00000001', spec: { shape: 'rect', widthUm: 300_000, heightUm: 300_000 } }))],
      ['300 px JPEG at 120 mm (63.5 dpi)', () => orderReq(withOrder({ uploadId: 'upload-jpg-0000000001', spec: { shape: 'rect', corners: 'sharp', widthUm: 120_000, heightUm: 90_000 } }))],
      ['custom shape with an opaque JPEG', () => orderReq(withOrder({ uploadId: 'upload-jpg-0000000001', spec: { shape: 'custom', widthUm: 50_000, heightUm: 50_000 } }))],
      ['custom shape with an encrypted PDF (reported as encrypted, not no_alpha)', () => orderReq(withOrder({ uploadId: 'upload-encpdf-00000001', spec: { shape: 'custom', widthUm: 50_000, heightUm: 50_000 } }))],
      ['PNG signature followed by garbage', () => orderReq(withOrder({ uploadId: 'upload-badpng-00000001' }))],
      ['encrypted PDF', () => orderReq(withOrder({ uploadId: 'upload-encpdf-00000001', spec: { shape: 'rect', widthUm: 30_000, heightUm: 30_000 } }))],
      ['unparseable PDF', () => orderReq(withOrder({ uploadId: 'upload-badpdf-00000001', spec: { shape: 'rect', widthUm: 30_000, heightUm: 30_000 } }))],
      ['stored bytes of an unsupported type', () => orderReq(withOrder({ uploadId: 'upload-gif-0000000001' }))],
      ['wrong HTTP content-type but valid JSON is still parsed', () => orderReq(withOrder({ sheets: 9 }), { 'content-type': 'text/plain' })],
    ];
    const rows: string[] = [];
    for (const [label, make] of cases) rows.push(await line(label, await ordersRoute(make())));
    expect({ rows, ordersStored: (await getStorage().listOrders()).length, filesUnderOrders: tree().filter((p) => p.startsWith('orders/')), eventsWritten: eventLines() }).toMatchSnapshot();
  });

  it('rate limit: the 6th order from one address in an hour is refused before the body is read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ip = '203.0.113.50';
    const rows: string[] = [];
    for (let i = 0; i < 5; i++) rows.push(await line(`call ${i + 1} (invalid body, still counted)`, await ordersRoute(orderReq({ nonsense: i }, { 'x-forwarded-for': ip }))));
    const sixth = orderReq({ nonsense: 6 }, { 'x-forwarded-for': ip });
    rows.push(await line('call 6', await ordersRoute(sixth)));
    rows.push(`call 6 body was read: ${sixth.bodyUsed}`);
    vi.setSystemTime(new Date(FROZEN.getTime() + 59 * 60 * 1000 + 30_500));
    rows.push(await line('call 7, 59 min 30.5 s later', await ordersRoute(orderReq({ nonsense: 7 }, { 'x-forwarded-for': ip }))));
    vi.setSystemTime(new Date(FROZEN.getTime() + 60 * 60 * 1000));
    rows.push(await line('call 8, exactly one hour after the first', await ordersRoute(orderReq({ nonsense: 8 }, { 'x-forwarded-for': ip }))));
    rows.push(await line('another address at the same time', await ordersRoute(orderReq({ nonsense: 9 }, { 'x-forwarded-for': '203.0.113.51' }))));
    // The right-most entry is the trusted one (TRUST_PROXY=1): a spoofed left entry does not help.
    vi.setSystemTime(FROZEN);
    (globalThis as { __epLimiters?: unknown }).__epLimiters = undefined;
    for (let i = 0; i < 5; i++) await ordersRoute(orderReq({ nonsense: i }, { 'x-forwarded-for': `10.0.0.${i}, ${ip}` }));
    rows.push(await line('spoofed first hop, same last hop', await ordersRoute(orderReq({ nonsense: 6 }, { 'x-forwarded-for': `10.9.9.9, ${ip}` }))));
    expect(rows).toMatchSnapshot();
  });

  it('TRUST_PROXY=0: one shared bucket with the limit x20', async () => {
    process.env.TRUST_PROXY = '0';
    (globalThis as { __epLimiters?: unknown }).__epLimiters = undefined;
    let ok = 0;
    for (let i = 0; i < 100; i++) if ((await ordersRoute(orderReq({ nonsense: i }))).status === 400) ok++;
    expect({ acceptedBeforeLimit: ok, next: await line('call 101 from yet another address', await ordersRoute(orderReq({ nonsense: 101 }))) }).toMatchSnapshot();
  });

  it('captcha: enforced only when TURNSTILE_SECRET_KEY is set; exact siteverify request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret-golden';
    await seedUploads();
    const calls: { url: string; method: string | undefined; body: string; hasSignal: boolean }[] = [];
    let answer: () => Promise<Response> = async () => new Response(JSON.stringify({ success: false }), { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method, body: String(init?.body), hasSignal: init?.signal instanceof AbortSignal });
        return answer();
      }),
    );
    const rows: string[] = [];
    const ip = { 'x-forwarded-for': '203.0.113.60' };
    rows.push(await line('no token (no request to Cloudflare)', await ordersRoute(orderReq(orderBody({ orderId: 'order-captcha-0000001' })))));
    rows.push(`fetch calls so far: ${calls.length}`);
    rows.push(await line('token rejected', await ordersRoute(orderReq(orderBody({ orderId: 'order-captcha-0000002', turnstileToken: 'tok-bad' }), ip))));
    answer = async () => new Response('<html>', { status: 500 });
    rows.push(await line('siteverify answers non-JSON', await ordersRoute(orderReq(orderBody({ orderId: 'order-captcha-0000003', turnstileToken: 'tok-x' })))));
    answer = async () => {
      throw new Error('network down');
    };
    rows.push(await line('siteverify unreachable', await ordersRoute(orderReq(orderBody({ orderId: 'order-captcha-0000004', turnstileToken: 'tok-y' })))));
    answer = async () => new Response(JSON.stringify({ success: 'true' }), { status: 200 });
    rows.push(await line('success must be the boolean true', await ordersRoute(orderReq(orderBody({ orderId: 'order-captcha-0000005', turnstileToken: 'tok-z' })))));
    rows.push(await line('captcha is checked before the phone (bad phone, no token)', await ordersRoute(orderReq(orderBody({ orderId: 'order-captcha-0000006', customer: customerBody({ phone: '12345' }) })))));
    answer = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
    const okRes = await ordersRoute(orderReq(orderBody({ orderId: 'order-captcha-0000007', turnstileToken: 'tok-good' })));
    rows.push(`token accepted -> ${okRes.status} ok=${((await okRes.json()) as { ok: boolean }).ok}`);
    // Only the first request is shown in full: it is the one sent from a fixed client address.
    expect({ rows, firstSiteverifyRequest: calls[0], totalFetchCalls: calls.length, allSameUrlAndMethod: calls.every((c) => c.url === calls[0].url && c.method === 'POST' && c.hasSignal) }).toMatchSnapshot();
  });

  it('server_error when the storage fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake = brokenStorage();
    const storageDown = await line('storage down', await ordersRoute(orderReq(orderBody())));
    fake = null;
    expect({ storageDown, logged: err.mock.calls.map((c) => [String(c[0]), c[1] instanceof Error ? c[1].message : String(c[1])]) }).toMatchSnapshot();
  });
});

/* ───────────────────────── happy path ───────────────────────── */

async function pdfFacts(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  const content = streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '')).join('\n');
  return {
    pages: doc.getPageCount(),
    title: mask(doc.getTitle() ?? ''),
    subject: doc.getSubject(),
    producer: doc.getProducer(),
    creationDate: doc.getCreationDate()?.toISOString(),
    contentLength: content.length,
    contentSha256: sha256(Buffer.from(content, 'latin1')),
    draws: (content.match(/\sDo(\s|$)/g) ?? []).length,
  };
}

/** wa.me link split into its base and the decoded (masked) text; also proves the encoding. */
function whatsappParts(url: string) {
  const [base, encoded = ''] = url.split('?text=');
  const text = decodeURIComponent(encoded);
  return { base, text: visible(mask(text)), encodingIsEncodeURIComponent: encodeURIComponent(text) === encoded };
}

describe('golden: full happy path — upload a design, place the order', () => {
  it('PNG circle order: responses, stored order, customers.json, analytics, PDF, console transport, replay', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await getStorage().saveSettings({ ...DEFAULT_SETTINGS, whatsapp: '9647709999999' });
    const client = { 'x-forwarded-for': '203.0.113.7', 'user-agent': UA, 'x-vercel-ip-city': 'Baghdad', 'x-vercel-ip-country-region': 'BG', 'x-vercel-ip-country': 'IQ' };

    // 1. upload
    const png = fx('padded-400x400.png');
    const upRes = await uploadRoute(await uploadReq(fileForm(png, 'شعار\u0007 logo.png', 'image/png'), client));
    const upStatus = upRes.status;
    const up = (await upRes.json()) as { ok: true; uploadId: string; kind: string; bytes: number };
    const ids = [up.uploadId];
    const uploadIdShape = /^[A-Za-z0-9_-]{21}$/.test(up.uploadId);
    const uploadMeta = readText(`uploads/${up.uploadId}.json`);
    const storedUploadIsTheFile = sha256(new Uint8Array(readFileSync(path.join(dataDir, 'uploads', `${up.uploadId}.bin`)))) === sha256(png);

    // 2. order
    const body = orderBody({ uploadId: up.uploadId, customer: customerBody({ notes: '  اتصلوا قبل التوصيل  ' }), priceIqd: 1, totalIqd: 1, price: { totalIqd: 1 } });
    const orderRes = await ordersRoute(orderReq(body, client));
    const orderStatus = orderRes.status;
    const orderHeaders = SHOWN_HEADERS.flatMap((n) => (orderRes.headers.get(n) === null ? [] : [`${n}=${orderRes.headers.get(n)}`]));
    const orderText = await orderRes.text();
    const order = JSON.parse(orderText) as { ok: true; displayNo: string; whatsappUrl: string; summary: Record<string, unknown>; notified: unknown; orderId: string };
    const displayNoShape = /^EP-261110-[2-9A-HJ-NP-Z]{4}$/.test(order.displayNo);

    const storedOrderText = readText('orders/order-golden-aaaaaaaaaa.json');
    const customersText = readText('customers.json');
    const events = eventLines();
    const pdf = await pdfFacts(new Uint8Array(readFileSync(path.join(dataDir, 'orders', 'order-golden-aaaaaaaaaa.pdf'))));
    const logged = log.mock.calls.map((args) => visible(mask(args.map(String).join(' '), ids)).replace(/\(\d+ bytes\)/, '(<N> bytes)'));
    const treeAfterOrder = tree().map((p) => mask(p, ids));

    // 3. the same order again (retry): same answer, nothing redone
    const replayRes = await ordersRoute(orderReq(body, { ...client, 'x-forwarded-for': '203.0.113.8' }));
    const replayText = await replayRes.text();
    const eventsAfterReplay = eventLines().length;

    // 4. a different order id sent twice at the same moment: processed once
    const twin = orderBody({ orderId: 'order-golden-bbbbbbbbbb', uploadId: up.uploadId, customer: customerBody({ name: undefined }) });
    const [t1, t2] = await Promise.all([ordersRoute(orderReq(twin, { 'x-forwarded-for': '203.0.113.9' })), ordersRoute(orderReq(twin, { 'x-forwarded-for': '203.0.113.10' }))]);
    const twinA = await t1.text();
    const twinB = await t2.text();

    expect({
      upload: {
        status: upStatus,
        body: { ...up, uploadId: uploadIdShape ? '<UPLOAD_ID>' : `UNEXPECTED SHAPE ${up.uploadId}` },
        storedMetaText: visible(uploadMeta),
        storedUploadIsTheFile,
      },
      order: {
        status: orderStatus,
        headers: orderHeaders,
        displayNoShape,
        body: { ...order, displayNo: mask(order.displayNo), summary: { ...order.summary, displayNo: mask(String(order.summary.displayNo)) }, whatsappUrl: whatsappParts(order.whatsappUrl) },
        keyOrder: Object.keys(order).join(','),
        summaryKeyOrder: Object.keys(order.summary).join(','),
      },
      storedOrderText: visible(mask(storedOrderText, ids)),
      customersText: visible(mask(customersText, ids)),
      events: events.map((l) => visible(mask(l, ids))),
      pdf,
      consoleTransport: logged,
      treeAfterOrder,
      replay: { status: replayRes.status, identicalBody: replayText === orderText, eventsAddedByReplay: eventsAfterReplay - events.length },
      concurrentTwin: {
        statuses: [t1.status, t2.status],
        identicalBodies: twinA === twinB,
        ordersStored: (await getStorage().listOrders()).map((o) => o.orderId).sort(),
        orderEvents: eventLines().filter((l) => (JSON.parse(l) as AnalyticsEvent).type === 'order').length,
        customers: (await getStorage().listCustomers()).map((c) => `${c.phone} orders=${c.ordersCount} total=${c.totalIqd} name=${c.name ?? '(none)'} lastOrderId=${c.lastOrderId}`),
      },
      errorsLogged: errors.mock.calls.length,
    }).toMatchSnapshot();
  });

  it('vector PDF order, prices hidden, no WhatsApp, Telegram transport', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.ORDER_TRANSPORT = 'telegram';
    process.env.TELEGRAM_BOT_TOKEN = '123456:GOLDEN-token_abc';
    process.env.TELEGRAM_CHAT_ID = '-1001234567890';
    const sent: { url: string; fields: Record<string, string> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const fields: Record<string, string> = {};
        for (const [k, v] of (init?.body as FormData).entries()) fields[k] = typeof v === 'string' ? visible(mask(v)) : `file name=${mask(v.name)} type=${v.type}`;
        sent.push({ url: String(url).replace('123456:GOLDEN-token_abc', '<TOKEN>'), fields });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    await getStorage().saveSettings({ ...DEFAULT_SETTINGS, pricesPublished: false });
    const client = { 'x-forwarded-for': '203.0.113.20', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' };
    const upRes = await uploadRoute(await uploadReq(fileForm(fx('cropbox-rot90.pdf'), 'art.pdf', 'application/pdf'), client));
    const up = (await upRes.json()) as { ok: true; uploadId: string; kind: string; bytes: number };
    const ids = [up.uploadId];
    const res = await ordersRoute(
      orderReq(
        orderBody({
          orderId: 'order-golden-pdf0000001',
          uploadId: up.uploadId,
          spec: { shape: 'rect', corners: 'sharp', widthUm: 30_000, heightUm: 40_000 },
          material: 'plastic',
          sheets: 50,
          customer: { phone: '+964 780 111 2222', governorate: 'البصرة', district: '', landmark: 'شارع الجزائر', name: '', notes: '' },
        }),
        client,
      ),
    );
    const text = await res.text();
    const stored = JSON.parse(readText('orders/order-golden-pdf0000001.json')) as OrderRecord;
    expect({
      upload: { ...up, uploadId: '<UPLOAD_ID>' },
      response: `${res.status} ${visible(mask(text, ids))}`,
      storedOrderText: visible(mask(readText('orders/order-golden-pdf0000001.json'), ids)),
      storedHasEffectiveDpiKey: 'effectiveDpi' in stored.design,
      storedCustomerKeys: Object.keys(stored.customer).join(','),
      customersText: visible(mask(readText('customers.json'), ids)),
      events: eventLines().map((l) => visible(mask(l, ids))),
      telegramRequests: sent,
    }).toMatchSnapshot();
  });
});

describe('golden: POST /api/orders — accepted edge cases', () => {
  it('custom shape with a vector PDF, rect without corners, circle from a non-square photo', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedUploads();
    const cases: [string, Record<string, unknown>][] = [
      ['custom shape + vector PDF (no transparency check for PDFs)', { orderId: 'order-edge-accept-0001', uploadId: 'upload-pdf-0000000001', spec: { shape: 'custom', widthUm: 30_000, heightUm: 40_000 } }],
      ['rect without corners', { orderId: 'order-edge-accept-0002', uploadId: 'upload-jpg-0000000001', spec: { shape: 'rect', widthUm: 50_000, heightUm: 50_000 } }],
      ['circle with stray corners from a 400x600 photo', { orderId: 'order-edge-accept-0003', uploadId: 'upload-exif-000000001', spec: { shape: 'circle', corners: 'sharp', widthUm: 60_000, heightUm: 60_000 } }],
      ['minimum order, landmark only, name and notes blank', { orderId: 'order-edge-accept-0004', sheets: 10, customer: { phone: '7701234567', governorate: 'Atlantis', district: '', landmark: 'x', name: '   ', notes: '   ' } }],
    ];
    const out: Record<string, unknown> = {};
    for (const [label, over] of cases) {
      const res = await ordersRoute(orderReq(orderBody(over)));
      const stored = await getStorage().getOrder(String(over.orderId));
      out[label] = {
        status: res.status,
        ok: ((await res.json()) as { ok: boolean }).ok,
        stored: stored ? { spec: stored.spec, layout: stored.layout, design: stored.design, customer: stored.customer, price: `${stored.price.material} x${stored.price.sheets} total=${stored.price.totalIqd}` } : null,
      };
    }
    expect(out).toMatchSnapshot();
  });
});

/* ───────────────────────── POST /api/upload ───────────────────────── */

describe('golden: POST /api/upload', () => {
  it('rejections and accepted files (max upload size lowered to 2000 bytes for the size cases)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await getStorage().saveSettings({ ...DEFAULT_SETTINGS, maxUploadBytes: 2_000 });
    const small = new Uint8Array([...PNG_SIG, 1, 2, 3]);
    const ids: string[] = [];
    const rows: string[] = [];
    const run = async (label: string, req: Request) => {
      const res = await uploadRoute(req);
      const clone = res.clone();
      try {
        const j = (await clone.json()) as { uploadId?: string };
        if (j.uploadId) ids.push(j.uploadId);
      } catch {
        /* not JSON */
      }
      rows.push(await line(label, res, ids));
    };
    const strForm = new FormData();
    strForm.set('file', 'just a string');
    const otherField = new FormData();
    otherField.set('design', new File([small as BlobPart], 'a.png'));
    const twoFiles = new FormData();
    twoFiles.append('file', new File([small as BlobPart], 'first.png'));
    twoFiles.append('file', new File([GIF as BlobPart], 'second.gif'));
    const bigBody = fileForm(new Uint8Array(70_000).fill(1), 'big.png');

    await run('no Content-Length header', await uploadReq(fileForm(small, 'a.png'), {}, null));
    await run('Content-Length is not a number', await uploadReq(fileForm(small, 'a.png'), {}, 'abc'));
    await run('Content-Length negative', await uploadReq(fileForm(small, 'a.png'), {}, '-5'));
    await run('declared length above max + 64 KiB', await uploadReq(fileForm(small, 'a.png'), {}, String(2_000 + 64 * 1024 + 1)));
    await run('declared length exactly max + 64 KiB (body is smaller)', await uploadReq(fileForm(small, 'a.png'), {}, String(2_000 + 64 * 1024)));
    await run('body larger than the cap although the header says 100', await uploadReq(bigBody, {}, '100'));
    await run('JSON body instead of multipart', new Request('http://localhost/api/upload', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '2', 'x-forwarded-for': nextIp() }, body: '{}' }));
    await run('multipart content-type with a broken body', new Request('http://localhost/api/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '5', 'x-forwarded-for': nextIp() }, body: 'hello' }));
    await run('no content-type at all', new Request('http://localhost/api/upload', { method: 'POST', headers: { 'content-length': '5', 'x-forwarded-for': nextIp() }, body: new Uint8Array([1, 2, 3, 4, 5]) }));
    await run('empty multipart form', await uploadReq(new FormData()));
    await run('field "file" is a string', await uploadReq(strForm));
    await run('file sent under another field name', await uploadReq(otherField));
    await run('empty file', await uploadReq(fileForm(new Uint8Array(0), 'empty.png')));
    await run('file of 2001 bytes (max is 2000)', await uploadReq(fileForm(new Uint8Array(2_001).fill(0x89), 'big.png')));
    await run('GIF labelled image/png', await uploadReq(fileForm(GIF, 'a.png', 'image/png')));
    await run('text file', await uploadReq(fileForm(new TextEncoder().encode('hello'), 'a.txt', 'text/plain')));
    await run('PNG by magic bytes (11 bytes, not a decodable image)', await uploadReq(fileForm(small, 'a.png', 'image/png')));
    await run('PNG of exactly 2000 bytes', await uploadReq(fileForm(new Uint8Array(2_000).fill(0).map((_, i) => (i < 8 ? PNG_SIG[i] : 7)), 'max.png')));
    await run('JPEG labelled application/pdf', await uploadReq(fileForm(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), 'photo.pdf', 'application/pdf')));
    await run('PDF header', await uploadReq(fileForm(new TextEncoder().encode('%PDF-1.7\n'), 'doc.bin')));
    await run('two "file" parts: the first one is used', await uploadReq(twoFiles));
    await run('name with control characters and 300 chars', await uploadReq(fileForm(small, `a\u0000b\u001fc\n${'x'.repeat(300)}.png`)));
    await run('Arabic file name', await uploadReq(fileForm(small, 'تصميم نهائي ١.png')));

    const metas = tree()
      .filter((p) => p.endsWith('.json') && p.startsWith('uploads/'))
      .map((p) => JSON.parse(readText(p)) as StoredFileMeta)
      .map((m) => `${m.mime} bytes=${m.bytes} createdAt=${m.createdAt} name(${m.originalName.length})=${visible(m.originalName.length > 40 ? `${m.originalName.slice(0, 12)}…${m.originalName.slice(-6)}` : m.originalName)}`)
      .sort();
    expect({
      rows,
      storedUploads: ids.length,
      idsAreNanoid21: ids.every((x) => /^[A-Za-z0-9_-]{21}$/.test(x)),
      idsAreUnique: new Set(ids).size === ids.length,
      metas,
      uploadEvents: eventLines().map((l) => {
        const e = JSON.parse(l) as AnalyticsEvent;
        return `${e.type} ${JSON.stringify(e.meta)} device=${e.device} ts=${e.ts}`;
      }),
    }).toMatchSnapshot();
  });

  it('rate limit (20 per hour per address) and server_error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ip = { 'x-forwarded-for': '203.0.113.70' };
    const small = new Uint8Array([...PNG_SIG, 1]);
    const statuses: number[] = [];
    // Rejected uploads count too: 10 valid + 10 invalid.
    for (let i = 0; i < 10; i++) statuses.push((await uploadRoute(await uploadReq(fileForm(small, 'a.png'), ip))).status);
    for (let i = 0; i < 10; i++) statuses.push((await uploadRoute(await uploadReq(fileForm(GIF, 'a.gif'), ip))).status);
    const limited = await line('upload 21', await uploadRoute(await uploadReq(fileForm(small, 'a.png'), ip)));
    const other = (await uploadRoute(await uploadReq(fileForm(small, 'a.png')))).status;
    fake = brokenStorage();
    const broken = await line('storage down', await uploadRoute(await uploadReq(fileForm(small, 'a.png'))));
    fake = null;
    expect({ statuses: statuses.join(','), limited, otherAddressStatus: other, broken, logged: err.mock.calls.map((c) => [String(c[0]), c[1] instanceof Error ? c[1].message : String(c[1])]) }).toMatchSnapshot();
  });
});

/* ───────────────────────── direct uploads ───────────────────────── */

type FakeDirect = StorageAdapter & { files: Map<string, Uint8Array>; metas: Map<string, StoredFileMeta>; events: AnalyticsEvent[]; deleted: string[]; signed: string[] };

function makeDirect(settings: Partial<ShopSettings> = {}, over: Partial<StorageAdapter> = {}): FakeDirect {
  const files = new Map<string, Uint8Array>();
  const metas = new Map<string, StoredFileMeta>();
  const events: AnalyticsEvent[] = [];
  const deleted: string[] = [];
  const signed: string[] = [];
  const a = {
    files,
    metas,
    events,
    deleted,
    signed,
    directUploadMaxBytes: 5_000,
    createDirectUpload: async (id: string) => {
      signed.push(id);
      return `https://sb.example/storage/v1/object/upload/sign/etihad/uploads/${id}.bin?token=t`;
    },
    saveUploadMeta: async (id: string, meta: StoredFileMeta) => void metas.set(id, meta),
    saveUpload: async () => {
      throw new Error('saveUpload must not be called for direct uploads');
    },
    deleteFile: async (rel: string) => {
      deleted.push(rel);
      files.delete(rel);
    },
    readFile: async (rel: string) => files.get(rel) ?? null,
    readUpload: async (id: string) => {
      const bytes = files.get(`uploads/${id}.bin`);
      const meta = metas.get(id);
      return bytes && meta ? { bytes, meta } : null;
    },
    getSettings: async () => ({ ...structuredClone(DEFAULT_SETTINGS), ...settings }),
    recordEvent: async (e: AnalyticsEvent) => void events.push(e),
    ...over,
  };
  return a as unknown as FakeDirect;
}

const startReq = (body: unknown, headers: Record<string, string> = {}) => jsonReq('http://localhost/api/upload/direct', body, headers);
const commitReq = (body: unknown, headers: Record<string, string> = {}) => jsonReq('http://localhost/api/upload/direct/commit', body, headers);

describe('golden: POST /api/upload/direct', () => {
  it('local storage always answers mode "server" (the body is not even read)', async () => {
    const rows = [
      await line('valid body', await directStart(startReq({ size: 1_000, name: 'a.png' }))),
      await line('invalid JSON', await directStart(startReq('{nope'))),
      await line('huge size', await directStart(startReq({ size: 1e12 }))),
      await line('empty body', await directStart(startReq(''))),
    ];
    expect(rows).toMatchSnapshot();
  });

  it('direct-capable storage: validation, size cap, signed URL, rate limit, server_error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = makeDirect({ maxUploadBytes: 4_000 });
    fake = f;
    const rows: string[] = [];
    const run = async (label: string, req: Request) => rows.push(await line(label, await directStart(req), f.signed));
    await run('invalid JSON', startReq('{nope'));
    await run('empty body', startReq(''));
    await run('JSON null', startReq('null'));
    await run('size missing', startReq({ name: 'a.png' }));
    await run('size 0', startReq({ size: 0 }));
    await run('size negative', startReq({ size: -1 }));
    await run('size fractional', startReq({ size: 10.5 }));
    await run('size as string', startReq({ size: '1000' }));
    await run('name 501 chars', startReq({ size: 10, name: 'x'.repeat(501) }));
    await run('name not a string', startReq({ size: 10, name: 5 }));
    await run('body over 4096 bytes', startReq({ size: 10, pad: 'x'.repeat(5_000) }));
    await run('size 4001 (settings max 4000, bucket max 5000)', startReq({ size: 4_001 }));
    await run('size 4000', startReq({ size: 4_000, name: 'a.png' }));
    await run('size 1 without a name', startReq({ size: 1 }));
    fake = makeDirect({ maxUploadBytes: 9_000 });
    rows.push(await line('size 5001 (settings max 9000, bucket max 5000)', await directStart(startReq({ size: 5_001 }))));
    fake = makeDirect({ maxUploadBytes: 9_000 }, { directUploadMaxBytes: undefined } as Partial<StorageAdapter>);
    rows.push(await line('size 9001 (no bucket limit)', await directStart(startReq({ size: 9_001 }))));
    const noLimit = await directStart(startReq({ size: 9_000 }));
    rows.push(`size 9000 (no bucket limit) -> ${noLimit.status}`);

    // rate limit shares the upload bucket: 20 per hour per address, invalid bodies count
    fake = makeDirect();
    const ip = { 'x-forwarded-for': '203.0.113.80' };
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await directStart(startReq(i % 2 ? { size: 10 } : '{bad', ip))).status);
    rows.push(`20 calls from one address -> ${statuses.join(',')}`);
    rows.push(await line('call 21', await directStart(startReq({ size: 10 }, ip))));

    fake = makeDirect({}, {
      createDirectUpload: async () => {
        throw new Error('GOLDEN sign failed');
      },
    });
    rows.push(await line('signing fails', await directStart(startReq({ size: 10 }))));
    fake = null;
    expect({
      rows,
      signedIdsAreNanoid21: f.signed.every((x) => /^[A-Za-z0-9_-]{21}$/.test(x)),
      signedCount: f.signed.length,
      logged: err.mock.calls.map((c) => [String(c[0]), c[1] instanceof Error ? c[1].message : String(c[1])]),
    }).toMatchSnapshot();
  });
});

describe('golden: POST /api/upload/direct/commit', () => {
  const ID = 'abcDEF_123-xyz';

  it('local storage (no direct uploads) and malformed bodies', async () => {
    const rows = [
      await line('valid body on local storage', await directCommit(commitReq({ uploadId: ID, name: 'a.png' }))),
      await line('invalid JSON', await directCommit(commitReq('{nope'))),
      await line('empty body', await directCommit(commitReq(''))),
      await line('uploadId missing', await directCommit(commitReq({ name: 'a.png' }))),
      await line('uploadId too short', await directCommit(commitReq({ uploadId: 'short' }))),
      await line('uploadId with traversal', await directCommit(commitReq({ uploadId: '../../settings' }))),
      await line('name 501 chars', await directCommit(commitReq({ uploadId: ID, name: 'x'.repeat(501) }))),
      await line('body over 4096 bytes', await directCommit(commitReq({ uploadId: ID, pad: 'x'.repeat(5_000) }))),
    ];
    expect(rows).toMatchSnapshot();
  });

  it('direct-capable storage: every outcome, what is stored, deleted and tracked', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = { 'x-forwarded-for': '203.0.113.90' };
    const out: Record<string, unknown> = {};
    const scenario = async (label: string, bytes: Uint8Array | null, body: unknown, settings: Partial<ShopSettings> = {}, before?: (f: FakeDirect) => void) => {
      const f = makeDirect(settings);
      if (bytes) f.files.set(`uploads/${ID}.bin`, bytes);
      before?.(f);
      fake = f;
      const row = await line(label, await directCommit(commitReq(body, client)));
      out[label] = {
        response: row.slice(label.length + 4),
        metaSaved: f.metas.get(ID) ?? null,
        deleted: f.deleted,
        binStillThere: f.files.has(`uploads/${ID}.bin`),
        events: f.events.map((e) => `${e.type} ${JSON.stringify(e.meta)} device=${e.device} visitor=${e.visitor} ts=${e.ts}`),
      };
    };
    const png = new Uint8Array([...PNG_SIG, 1, 2, 3]);
    await scenario('PNG committed', png, { uploadId: ID, name: 'logo.png' });
    await scenario('JPEG committed without a name', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]), { uploadId: ID });
    await scenario('PDF committed, name sanitised and cut to 200', new TextEncoder().encode('%PDF-1.7\n'), { uploadId: ID, name: `a\u0001b\n${'n'.repeat(400)}` });
    await scenario('empty name falls back to "design"', png, { uploadId: ID, name: '' });
    await scenario('no file in the bucket', null, { uploadId: ID });
    await scenario('empty file', new Uint8Array(0), { uploadId: ID });
    await scenario('file above the bucket limit (5000)', new Uint8Array(5_001).fill(1), { uploadId: ID });
    await scenario('file above settings.maxUploadBytes (1024)', new Uint8Array(1_025).fill(1), { uploadId: ID }, { maxUploadBytes: 1_024 });
    await scenario('file exactly at settings.maxUploadBytes (1024), PNG', new Uint8Array(1_024).fill(0).map((_, i) => (i < 8 ? PNG_SIG[i] : 3)), { uploadId: ID }, { maxUploadBytes: 1_024 });
    await scenario('unsupported type (GIF)', GIF, { uploadId: ID, name: 'a.gif' });
    await scenario('already committed: answered from the stored meta, nothing re-tracked', png, { uploadId: ID, name: 'other-name.png' }, {}, (f) =>
      f.metas.set(ID, { mime: 'image/png', originalName: 'first-name.png', bytes: 11, createdAt: '2026-11-10T08:00:00.000Z' }),
    );
    await scenario('already committed but the stored bytes are unsupported', GIF, { uploadId: ID }, {}, (f) =>
      f.metas.set(ID, { mime: 'image/png', originalName: 'x.png', bytes: 10, createdAt: '2026-11-10T08:00:00.000Z' }),
    );

    // adapter without saveUploadMeta: falls back to saveUpload(id, bytes, meta)
    const saved: unknown[] = [];
    const f2 = makeDirect({}, {
      saveUploadMeta: undefined,
      saveUpload: async (id: string, bytes: Uint8Array, meta: StoredFileMeta) => {
        saved.push({ id, bytes: bytes.byteLength, meta });
        return `uploads/${id}.bin`;
      },
    } as Partial<StorageAdapter>);
    f2.files.set(`uploads/${ID}.bin`, png);
    fake = f2;
    const fallback = await line('no saveUploadMeta', await directCommit(commitReq({ uploadId: ID, name: 'logo.png' }, client)));

    fake = brokenStorage();
    const broken = await line('storage down', await directCommit(commitReq({ uploadId: ID })));
    fake = null;
    expect({ out, fallback, saved, broken, logged: err.mock.calls.map((c) => [String(c[0]), c[1] instanceof Error ? c[1].message : String(c[1])]) }).toMatchSnapshot();
  });
});

/* ───────────────────────── POST /api/track ───────────────────────── */

describe('golden: POST /api/track', () => {
  const trackReq = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://softy.iq/api/track', {
      method: 'POST',
      headers: { 'user-agent': UA, 'x-forwarded-for': '203.0.113.100', host: 'softy.iq', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('invalid bodies -> 400; bots and admin paths -> 204 and nothing stored', async () => {
    const rows: string[] = [];
    const run = async (label: string, req: Request) => rows.push(await line(label, await trackRoute(req)));
    await run('not JSON', trackReq('{bad'));
    await run('empty body', trackReq(''));
    await run('JSON null', trackReq('null'));
    await run('type order (server-side only)', trackReq({ type: 'order', path: '/' }));
    await run('type upload (server-side only)', trackReq({ type: 'upload', path: '/' }));
    await run('type missing', trackReq({ path: '/' }));
    await run('path missing', trackReq({ type: 'pageview' }));
    await run('path without leading slash', trackReq({ type: 'pageview', path: 'home' }));
    await run('path 201 chars', trackReq({ type: 'pageview', path: `/${'a'.repeat(200)}` }));
    await run('unknown step', trackReq({ type: 'step', path: '/', step: 'checkout' }));
    await run('referrer 501 chars', trackReq({ type: 'pageview', path: '/', referrer: `https://x.example/${'a'.repeat(490)}` }));
    await run('utm 61 chars', trackReq({ type: 'pageview', path: '/', utm: 'u'.repeat(61) }));
    await run('body over 4096 bytes', trackReq({ type: 'pageview', path: '/', pad: 'x'.repeat(5_000) }));
    await run('bot user agent', trackReq({ type: 'pageview', path: '/' }, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }));
    await run('empty user agent', trackReq({ type: 'pageview', path: '/' }, { 'user-agent': '' }));
    await run('bot with an invalid body is still 400', trackReq({ type: 'nope', path: '/' }, { 'user-agent': 'curl/8.4.0' }));
    await run('path /admin', trackReq({ type: 'pageview', path: '/admin' }));
    await run('path /admin/orders', trackReq({ type: 'pageview', path: '/admin/orders' }));
    expect({ rows, eventsWritten: eventLines(), filesWritten: tree() }).toMatchSnapshot();
  });

  it('accepted events: exactly what is stored', async () => {
    const geo = { 'x-vercel-ip-city': encodeURIComponent('بغداد'), 'x-vercel-ip-country-region': 'BG', 'x-vercel-ip-country': 'IQ' };
    const calls: [string, Request][] = [
      ['pageview, no referrer and no utm (no source)', trackReq({ type: 'pageview', path: '/' })],
      ['pageview, empty referrer -> direct', trackReq({ type: 'pageview', path: '/', referrer: '' })],
      ['pageview from Instagram with geo headers', trackReq({ type: 'pageview', path: '/', referrer: 'https://l.instagram.com/?u=secret' }, geo)],
      ['pageview, utm wins over referrer', trackReq({ type: 'pageview', path: '/how-it-works', referrer: 'https://www.google.com/', utm: 'tiktok' })],
      ['pageview, unknown utm -> other', trackReq({ type: 'pageview', path: '/', utm: 'newsletter' })],
      ['pageview, empty utm and no referrer (no source)', trackReq({ type: 'pageview', path: '/', utm: '' })],
      ['pageview, referrer is our own host', trackReq({ type: 'pageview', path: '/', referrer: 'https://softy.iq/how-it-works' })],
      ['pageview, own host taken from x-forwarded-host', trackReq({ type: 'pageview', path: '/', referrer: 'https://www.softy.iq/x' }, { 'x-forwarded-host': 'www.softy.iq' })],
      ['pageview, malformed referrer -> other', trackReq({ type: 'pageview', path: '/', referrer: 'not a url' })],
      ['pageview with a step is kept', trackReq({ type: 'pageview', path: '/', step: 'shape' })],
      ['step size (referrer ignored for steps)', trackReq({ type: 'step', path: '/', step: 'size', referrer: 'https://www.facebook.com/' })],
      ['step without a step value', trackReq({ type: 'step', path: '/' })],
      ['install shown', trackReq({ type: 'install', path: '/', step: 'shown' })],
      ['install installed, desktop', trackReq({ type: 'install', path: '/', step: 'installed' }, { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36' })],
      ['unknown body keys are dropped', trackReq({ type: 'pageview', path: '/', visitor: 'forged', ts: '2000-01-01T00:00:00Z', device: 'desktop', city: 'Forged' })],
      ['path /administrator is not an admin path', trackReq({ type: 'pageview', path: '/administrator' })],
      ['another address', trackReq({ type: 'pageview', path: '/' }, { 'x-forwarded-for': '203.0.113.101' })],
    ];
    const statuses: string[] = [];
    const stored: Record<string, string> = {};
    for (const [label, r] of calls) {
      const before = eventLines().length;
      const res = await trackRoute(r);
      statuses.push(`${res.status}`);
      const lines = eventLines();
      stored[label] = lines.length === before + 1 ? visible(lines[lines.length - 1]) : `UNEXPECTED: ${lines.length - before} events written`;
    }
    expect({ statuses: statuses.join(','), stored }).toMatchSnapshot();
  });

  it('per-visitor limit: 300 events an hour, the rest are dropped silently', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 305; i++) lastStatus = (await trackRoute(trackReq({ type: 'step', path: '/', step: 'shape' }))).status;
    const afterBurst = eventLines().length;
    const other = await trackRoute(trackReq({ type: 'pageview', path: '/' }, { 'x-forwarded-for': '203.0.113.102' }));
    expect({ lastStatus, storedAfter305: afterBurst, otherVisitorStatus: other.status, storedAfterOtherVisitor: eventLines().length }).toMatchSnapshot();
  });

  it('a storage failure is swallowed (204)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake = brokenStorage();
    const row = await line('storage down', await trackRoute(trackReq({ type: 'pageview', path: '/' })));
    fake = null;
    expect({ row, logged: err.mock.calls.map((c) => c.map(String)) }).toMatchSnapshot();
  });
});

/* ───────────────────────── POST /api/log ───────────────────────── */

describe('golden: POST /api/log', () => {
  const logReq = (body: unknown, headers: Record<string, string> = {}) => jsonReq('http://localhost/api/log', body, headers);

  it('always 204 (413 when oversize); only valid events reach console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = JSON.stringify({ step: 'other', message: 'm', pad: 'x'.repeat(9_000) });
    const cases: [string, Request][] = [
      ['valid minimal', logReq({ step: 'decode', message: 'boom' })],
      ['valid full, unknown keys dropped', logReq({ step: 'upload', message: 'فشل الرفع', fileType: 'image/png', fileSize: 12_345, userAgent: 'UA/1', secret: 'x' })],
      ['invalid step', logReq({ step: 'checkout', message: 'm' })],
      ['message too long', logReq({ step: 'other', message: 'x'.repeat(1_025) })],
      ['not JSON', logReq('{bad')],
      ['empty body', logReq('')],
      ['JSON null', logReq('null')],
      ['declared length over 8 KiB', logReq(big, { 'content-length': String(big.length) })],
      ['body over 8 KiB without a declared length', logReq(big)],
    ];
    const rows: string[] = [];
    for (const [label, r] of cases) {
      const before = warn.mock.calls.length;
      rows.push(`${await line(label, await logRoute(r))} | warned=${warn.mock.calls.length - before}`);
    }
    // limit: 60 per hour per address; over the limit the answer is still 204 but nothing is logged
    const ip = { 'x-forwarded-for': '203.0.113.110' };
    warn.mockClear();
    let last = 0;
    for (let i = 0; i < 65; i++) last = (await logRoute(logReq({ step: 'other', message: `m${i}` }, ip))).status;
    expect({ rows, burst: { lastStatus: last, warnedOutOf65: warn.mock.calls.length, lastWarn: warn.mock.calls[warn.mock.calls.length - 1] } }).toMatchSnapshot();
  });

  it('exact console.warn arguments', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await logRoute(logReq({ step: 'upload', message: 'فشل الرفع', fileType: 'image/png', fileSize: 12_345, userAgent: 'UA/1', secret: 'x' }));
    await logRoute(logReq({ message: 'key order follows the input', step: 'decode' }));
    expect(warn.mock.calls).toMatchSnapshot();
  });
});

/* ───────────────────────── GET /api/cron/purge ───────────────────────── */

describe('golden: GET /api/cron/purge', () => {
  const CRON = 'cron-secret-for-golden-0123456789';
  const purge = (auth?: string, query = '') => cronPurge(new Request(`http://localhost/api/cron/purge${query}`, { headers: auth ? { authorization: auth } : {} }));

  const orderRecord = (orderId: string, createdAt: string, uploadId: string): OrderRecord =>
    ({
      orderId,
      displayNo: `EP-000000-${orderId.slice(-4).toUpperCase()}`,
      createdAt,
      status: 'new',
      price: { totalIqd: 10_000 },
      customer: { phone: '9647701234567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر', name: 'علي' },
      files: { designPath: `uploads/${uploadId}.bin`, pdfPath: `orders/${orderId}.pdf` },
    }) as unknown as OrderRecord;

  async function seed(): Promise<void> {
    const s = getStorage();
    const add = async (orderId: string, createdAt: string, uploadId: string, mtime: string) => {
      await s.saveUpload(uploadId, new Uint8Array([1]), META('a.png', 1));
      await s.savePdf(orderId, new Uint8Array([2]));
      const rec = orderRecord(orderId, createdAt, uploadId);
      await s.saveOrder(rec);
      await s.upsertCustomerFromOrder(rec);
      for (const ext of ['bin', 'json']) utimesSync(path.join(dataDir, 'uploads', `${uploadId}.${ext}`), new Date(mtime), new Date(mtime));
    };
    await add('order-old-00001', '2026-10-01T00:00:00.000Z', 'upload-old-0001', '2026-10-01T00:00:00.000Z'); // 40 days old
    await add('order-edge-0001', '2026-10-11T08:59:59.999Z', 'upload-edge-001', '2026-10-11T08:59:59.000Z'); // 1 ms older than 30 days
    await add('order-edge-0002', '2026-10-11T09:00:00.000Z', 'upload-edge-002', '2026-10-11T09:00:00.000Z'); // exactly 30 days: kept
    await add('order-new-00001', '2026-11-09T00:00:00.000Z', 'upload-new-0001', '2026-11-09T00:00:00.000Z');
    await s.saveUpload('upload-orphan-01', new Uint8Array([1]), META('a.png', 1));
    for (const ext of ['bin', 'json']) utimesSync(path.join(dataDir, 'uploads', `upload-orphan-01.${ext}`), new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-01T00:00:00.000Z'));
    for (const ts of ['2025-01-15T00:00:00.000Z', '2025-09-30T23:59:59.000Z', '2025-10-06T08:00:00.000Z', '2026-11-01T00:00:00.000Z']) await s.recordEvent({ ts, type: 'pageview', visitor: 'v' });
  }

  it('401 unless the exact bearer secret is sent', async () => {
    const rows: string[] = [];
    rows.push(await line('CRON_SECRET unset, no header', await purge()));
    rows.push(await line('CRON_SECRET unset, "Bearer "', await purge('Bearer ')));
    process.env.CRON_SECRET = 'short';
    rows.push(await line('CRON_SECRET shorter than 16 chars, matching header', await purge('Bearer short')));
    process.env.CRON_SECRET = CRON;
    rows.push(await line('no header', await purge()));
    rows.push(await line('wrong secret', await purge('Bearer nope')));
    rows.push(await line('secret without the Bearer prefix', await purge(CRON)));
    rows.push(await line('lower-case bearer', await purge(`bearer ${CRON}`)));
    // The Headers API strips surrounding whitespace, so this is the correct secret (and a real purge of an empty dir).
    rows.push(await line('trailing space in the header value', await purge(`Bearer ${CRON} `)));
    rows.push(await line('same length, one char different', await purge(`Bearer ${CRON.slice(0, -1)}X`)));
    process.env.CRON_SECRET = `  ${CRON}  `;
    rows.push(await line('secret in env is trimmed', await purge(`Bearer ${CRON}`, '?dry=1')));
    expect(rows).toMatchSnapshot();
  });

  it('authorised: dry run reports, real run deletes; customers and recent data stay', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.CRON_SECRET = CRON;
    await seed();
    const before = tree();
    const dry = await line('dry run (?dry=1)', await purge(`Bearer ${CRON}`, '?dry=1'));
    const untouched = JSON.stringify(tree()) === JSON.stringify(before);
    const real = await line('real run', await purge(`Bearer ${CRON}`));
    const after = tree();
    const again = await line('second real run', await purge(`Bearer ${CRON}`, '?dry=0'));
    expect({
      before,
      dry,
      dryRunLeftEverything: untouched,
      real,
      removedPaths: before.filter((p) => !after.includes(p)),
      after,
      again,
      customersKept: (await getStorage().listCustomers()).map((c) => `${c.phone} orders=${c.ordersCount}`),
      logged: log.mock.calls.map((c) => c.map(String).join(' ')),
    }).toMatchSnapshot();
  });

  it('retentionDays comes from settings; unsupported and failing storage', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CRON_SECRET = CRON;
    await seed();
    await getStorage().saveSettings({ ...DEFAULT_SETTINGS, retentionDays: 1 });
    const oneDay = await line('retentionDays = 1, dry', await purge(`Bearer ${CRON}`, '?dry=1'));
    fake = { getSettings: async () => structuredClone(DEFAULT_SETTINGS) } as unknown as StorageAdapter;
    const unsupported = await line('storage without purgeOlderThan', await purge(`Bearer ${CRON}`));
    fake = { purgeOlderThan: async () => ['a', 'b', 'c'], getSettings: async () => structuredClone(DEFAULT_SETTINGS) } as unknown as StorageAdapter;
    const noEvents = await line('storage without purgeEventsOlderThan', await purge(`Bearer ${CRON}`));
    // Which query strings mean "dry run", and the two cutoffs handed to the storage.
    const seen: string[] = [];
    fake = {
      purgeOlderThan: async (cutoff: Date, dryRun: boolean) => {
        seen.push(`orders cutoff=${cutoff.toISOString()} dryRun=${dryRun}`);
        return [];
      },
      purgeEventsOlderThan: async (cutoff: Date, dryRun: boolean) => {
        seen.push(`events cutoff=${cutoff.toISOString()} dryRun=${dryRun}`);
        return ['x'];
      },
      getSettings: async () => structuredClone(DEFAULT_SETTINGS),
    } as unknown as StorageAdapter;
    const flags: string[] = [];
    for (const q of ['', '?dry=1', '?dry=0', '?dry=true', '?dry=', '?DRY=1', '?dry=1&dry=0', '?x=1&dry=1']) {
      seen.length = 0;
      const res = await purge(`Bearer ${CRON}`, q);
      flags.push(`${q || '(no query)'} -> ${res.status} ${JSON.stringify(await res.json())} | ${seen.join(' | ')}`);
    }
    fake = brokenStorage();
    const broken = await line('storage down', await purge(`Bearer ${CRON}`));
    fake = null;
    expect({ oneDay, unsupported, noEvents, flags, broken, logged: err.mock.calls.map((c) => [String(c[0]), c[1] instanceof Error ? c[1].message : String(c[1])]) }).toMatchSnapshot();
  });
});

/* ───────────────────────── GET /api/admin/customers ───────────────────────── */

describe('golden: GET /api/admin/customers (CSV export)', () => {
  const rec = (orderId: string, createdAt: string, customer: Partial<OrderRecord['customer']>, totalIqd: number | null, displayNo: string): OrderRecord =>
    ({
      orderId,
      displayNo,
      createdAt,
      status: 'new',
      price: { totalIqd },
      customer: { phone: '9647701234567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر', ...customer },
      files: { designPath: `uploads/${orderId}.bin`, pdfPath: `orders/${orderId}.pdf` },
    }) as unknown as OrderRecord;

  async function seedCustomers(): Promise<void> {
    const s = getStorage();
    await s.upsertCustomerFromOrder(rec('order-csv-000001', '2026-11-01T09:00:00.000Z', { name: 'علي حسين' }, 19_400, 'EP-261101-AAAA'));
    await s.upsertCustomerFromOrder(rec('order-csv-000002', '2026-11-09T21:30:00.000Z', { name: 'علي حسين', district: 'المنصور, شارع 14', landmark: 'قرب "المطعم"' }, 68_750, 'EP-261110-BBBB'));
    await s.upsertCustomerFromOrder(rec('order-csv-000003', '2026-11-05T12:00:00.000Z', { phone: '9647801112222', name: '=HYPERLINK("http://evil.example","x")', governorate: 'البصرة', district: '', landmark: '+964 line\nsecond line' }, null, 'EP-261105-CCCC'));
    await s.upsertCustomerFromOrder(rec('order-csv-000004', '2026-10-31T20:59:59.000Z', { phone: '9647501112222', governorate: 'أربيل', district: '-عنكاوا', landmark: '@home\ttab' }, 0, 'EP-261031-DDDD'));
  }

  const csvShot = async (res: Response) => {
    const buf = new Uint8Array(await res.clone().arrayBuffer());
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf);
    return {
      status: res.status,
      headers: SHOWN_HEADERS.flatMap((n) => (res.headers.get(n) === null ? [] : [`${n}=${res.headers.get(n)}`])),
      firstThreeBytes: Array.from(buf.slice(0, 3)).map((b) => b.toString(16)),
      lines: text.split('\r\n').map((l) => visible(l)),
      crlfCount: (text.match(/\r\n/g) ?? []).length,
      bareLfCount: (text.replace(/\r\n/g, '').match(/\n/g) ?? []).length,
      byteLength: buf.byteLength,
      sha256: sha256(buf),
    };
  };

  it('unauthorised without a valid session cookie', async () => {
    await seedCustomers();
    const rows = [await line('no cookie', await customersCsv())];
    jar.set(COOKIE_NAME, 'garbage');
    rows.push(await line('garbage cookie', await customersCsv()));
    jar.set(COOKIE_NAME, await signToken('y'.repeat(40)));
    rows.push(await line('token signed with another secret', await customersCsv()));
    jar.set(COOKIE_NAME, await signToken(SECRET, FROZEN.getTime() - 8 * 24 * 3600 * 1000));
    rows.push(await line('token issued 8 days ago (expired)', await customersCsv()));
    jar.set(COOKIE_NAME, await signToken(SECRET));
    delete process.env.SESSION_SECRET;
    rows.push(await line('valid token but SESSION_SECRET unset', await customersCsv()));
    expect(rows).toMatchSnapshot();
  });

  it('authorised: exact CSV bytes (BOM, CRLF, quoting, formula guard) and headers', async () => {
    await seedCustomers();
    jar.set(COOKIE_NAME, await signToken(SECRET));
    const full = await csvShot(await customersCsv());
    // a token 5 seconds before its 7-day expiry still works
    jar.set(COOKIE_NAME, await signToken(SECRET, FROZEN.getTime() - (7 * 24 * 3600 - 5) * 1000));
    const almostExpiredStatus = (await customersCsv()).status;
    // the file name carries the UTC date, not the Baghdad one (02:59 on Jan 1st in Baghdad)
    vi.setSystemTime(new Date('2026-12-31T23:59:59.000Z'));
    jar.set(COOKIE_NAME, await signToken(SECRET));
    const newYearsEve = (await customersCsv()).headers.get('content-disposition');
    expect({ full, almostExpiredStatus, newYearsEve }).toMatchSnapshot();
  });

  it('authorised with no customers: header row only', async () => {
    jar.set(COOKIE_NAME, await signToken(SECRET));
    writeFileSync(path.join(dataDir, 'customers.json'), '[]');
    expect(await csvShot(await customersCsv())).toMatchSnapshot();
  });
});
