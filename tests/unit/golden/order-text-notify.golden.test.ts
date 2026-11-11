/**
 * GOLDEN — order-text.ts and src/lib/notify (index.ts + telegram.ts).
 * Exact text of the WhatsApp/summary text, the Telegram HTML caption, and the exact
 * request the Telegram transport would send (fetch is stubbed; nothing leaves the machine).
 *
 * Masked: the bot token inside the request URL -> <TOKEN>.
 * Note: money and the caption time go through Intl (ar-IQ-u-nu-latn), so these strings are
 * tied to the ICU data of the Node version in use.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { notifyShop } from '@/lib/notify';
import { buildCaption, sendTelegram } from '@/lib/notify/telegram';
import { orderSummaryText, shapeLabel, sizeLabel } from '@/lib/order-text';
import type { Corners, Material, OrderRecord, OrderSummary, Shape, ShopSettings } from '@/lib/types';
import { setupEnv } from '../server/helpers';
import { removeTempDirs, sha256, show, track, visible } from './_util';

afterAll(removeTempDirs);

const TOKEN = '123456:GOLDEN-token_abc';

/* ───────────────────────── order-text ───────────────────────── */

const summary = (over: Partial<OrderSummary> = {}): OrderSummary => ({
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
  ...over,
});
const UNPRICED: Partial<OrderSummary> = { unitPriceIqd: null, subtotalIqd: null, totalIqd: null, discountPercent: 0 };

describe('golden: orderSummaryText', () => {
  const SHAPES: [string, Partial<OrderSummary>][] = [
    ['circle 3cm', { shape: 'circle', widthUm: 30_000, heightUm: 30_000 }],
    ['rect rounded 5x3cm', { shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 30_000, countPerSheet: 27, totalStickers: 540 }],
    ['rect sharp 4.24x3cm', { shape: 'rect', corners: 'sharp', widthUm: 42_420, heightUm: 30_000, countPerSheet: 36, totalStickers: 720 }],
    ['rect (corners missing) 10x4cm', { shape: 'rect', widthUm: 100_000, heightUm: 40_000, countPerSheet: 6, totalStickers: 120 }],
    ['custom 5x2.5cm', { shape: 'custom', widthUm: 50_000, heightUm: 25_000, countPerSheet: 30, totalStickers: 600 }],
  ];
  const PRICES: [string, Partial<OrderSummary>][] = [
    ['paper priced with 10% discount', {}],
    ['paper priced without discount', { sheets: 10, unitPriceIqd: 800, discountPercent: 0, subtotalIqd: 8_000, totalIqd: 13_000 }],
    ['plastic priced with 15% discount', { material: 'plastic', sheets: 50, unitPriceIqd: 1_275, discountPercent: 15, subtotalIqd: 63_750, totalIqd: 68_750 }],
    ['plastic unpriced', { material: 'plastic', ...UNPRICED }],
    ['paper unpriced, discount tier reached', { ...UNPRICED, discountPercent: 20, sheets: 100 }],
  ];
  it('matrix: shape x price state', () => {
    const out: Record<string, string> = {};
    for (const [sName, s] of SHAPES) {
      for (const [pName, p] of PRICES) out[`${sName} | ${pName}`] = visible(orderSummaryText(summary({ ...s, ...p })));
    }
    expect(out).toMatchSnapshot();
  });
  it('plural agreement and odd values', () => {
    const cases: [string, Partial<OrderSummary>][] = [
      ['1 per sheet, 1 sheet', { countPerSheet: 1, sheets: 1, totalStickers: 1 }],
      ['2 per sheet, 2 sheets', { countPerSheet: 2, sheets: 2, totalStickers: 4 }],
      ['3 per sheet, 10 sheets', { countPerSheet: 3, sheets: 10, totalStickers: 30 }],
      ['11 per sheet, 11 sheets', { countPerSheet: 11, sheets: 11, totalStickers: 121 }],
      ['100 per sheet, 100 sheets', { countPerSheet: 100, sheets: 100, totalStickers: 10_000 }],
      ['0 per sheet, 0 sheets', { countPerSheet: 0, sheets: 0, totalStickers: 0 }],
      ['1568 per sheet, 5000 sheets', { countPerSheet: 1_568, sheets: 5_000, totalStickers: 7_840_000 }],
      ['zero delivery fee', { deliveryFeeIqd: 0, totalIqd: 14_400 }],
      ['unit price known but subtotal/total null', { subtotalIqd: null, totalIqd: null }],
      ['unit price null but total known', { unitPriceIqd: null, discountPercent: 10 }],
      ['empty display number', { displayNo: '' }],
      ['degraded display number', { displayNo: '—' }],
      ['size not on the 0.01 cm grid', { shape: 'custom', widthUm: 12_345, heightUm: 6_789 }],
    ];
    expect(Object.fromEntries(cases.map(([name, over]) => [name, visible(orderSummaryText(summary(over)))]))).toMatchSnapshot();
  });
  it('shapeLabel / sizeLabel tables', () => {
    const shapes: Shape[] = ['circle', 'rect', 'custom'];
    const corners: (Corners | undefined)[] = [undefined, 'rounded', 'sharp'];
    const labels: string[] = [];
    for (const s of shapes) for (const c of corners) labels.push(`${s}/${String(c)} -> ${shapeLabel(s, c)}`);
    labels.push(`unknown shape -> ${shapeLabel('hexagon' as Shape, 'sharp')}`);
    const sizes: [number, number][] = [
      [30_000, 30_000],
      [42_420, 30_000],
      [5_000, 196_000],
      [12_345, 6_789],
      [100, 49],
      [0, 0],
      [Number.NaN, 30_000],
    ];
    expect({ labels, sizes: sizes.map(([w, h]) => `${show(w)} x ${show(h)} -> ${visible(sizeLabel(w, h))}`) }).toMatchSnapshot();
  });
});

/* ───────────────────────── telegram ───────────────────────── */

type RecOver = {
  spec?: Partial<OrderRecord['spec']>;
  layout?: Partial<OrderRecord['layout']>;
  design?: Partial<OrderRecord['design']>;
  price?: Partial<OrderRecord['price']>;
  customer?: Partial<OrderRecord['customer']>;
} & Partial<Pick<OrderRecord, 'displayNo' | 'createdAt' | 'status' | 'orderId'>>;

function rec(over: RecOver = {}): OrderRecord {
  const { spec, layout, design, price, customer, ...top } = over;
  return {
    orderId: 'order-golden-000000001',
    displayNo: 'EP-251107-AB3C',
    createdAt: '2025-11-07T10:00:00.000Z',
    status: 'new',
    spec: { shape: 'circle', widthUm: 30_000, heightUm: 30_000, ...spec },
    layout: { cols: 6, rows: 9, countPerSheet: 54, rotated: false, turnedCount: 0, cellWidthUm: 30_000, cellHeightUm: 30_000, gapXUm: 2_000, gapYUm: 0, ...layout },
    design: { kind: 'png', originalName: 'logo.png', bytes: 12_345, pxWidth: 900, pxHeight: 900, effectiveDpi: 762, ...design },
    price: {
      material: 'paper',
      sheets: 20,
      unitBaseIqd: 800,
      discountPercent: 10,
      unitPriceIqd: 720,
      subtotalIqd: 14_400,
      deliveryFeeIqd: 5_000,
      totalIqd: 19_400,
      totalStickers: 1_080,
      perStickerIqd: 18,
      ...price,
    },
    customer: { name: 'علي حسين', phone: '9647701234567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر', ...customer },
    files: { designPath: 'uploads/upload-golden-00000001.bin', pdfPath: 'orders/order-golden-000000001.pdf' },
    notified: { telegram: 'skipped' },
    ...top,
  };
}

const UNPRICED_PRICE: Partial<OrderRecord['price']> = { unitBaseIqd: null, unitPriceIqd: null, subtotalIqd: null, totalIqd: null, perStickerIqd: null };

const CAPTION_CASES: [string, RecOver][] = [
  ['circle / paper / priced + discount / name, no notes', {}],
  ['circle / plastic / unpriced / no name / notes', { price: { material: 'plastic', ...UNPRICED_PRICE, discountPercent: 0 }, customer: { name: undefined, notes: 'اتصلوا قبل التوصيل' } }],
  ['circle / unpriced but discount tier reached', { price: { ...UNPRICED_PRICE, discountPercent: 20, sheets: 100, totalStickers: 5_400 } }],
  [
    'rect rounded / plastic / priced no discount / notes',
    {
      spec: { shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 30_000 },
      layout: { cols: 3, rows: 9, countPerSheet: 27, cellWidthUm: 50_000, cellHeightUm: 30_000, gapXUm: 2_000, gapYUm: 2_000 },
      price: { material: 'plastic', sheets: 10, unitBaseIqd: 1_500, discountPercent: 0, unitPriceIqd: 1_500, subtotalIqd: 15_000, totalIqd: 20_000, totalStickers: 270, perStickerIqd: 74 },
      customer: { notes: '  ألوان زاهية رجاءً  ' },
    },
  ],
  [
    'rect sharp / paper / jpeg / fractional dpi',
    {
      spec: { shape: 'rect', corners: 'sharp', widthUm: 42_420, heightUm: 30_000 },
      layout: { countPerSheet: 36 },
      design: { kind: 'jpeg', originalName: 'صورة.jpg', effectiveDpi: 239.4984 },
    },
  ],
  ['rect without corners', { spec: { shape: 'rect', widthUm: 100_000, heightUm: 40_000 }, layout: { countPerSheet: 6 } }],
  [
    'custom / vector pdf (no dpi)',
    { spec: { shape: 'custom', widthUm: 50_000, heightUm: 25_000 }, layout: { countPerSheet: 30 }, design: { kind: 'pdf', originalName: 'art.pdf', effectiveDpi: undefined } },
  ],
  ['dpi rounds half up (149.5)', { design: { effectiveDpi: 149.5 } }],
  ['html in every free-text field', { displayNo: 'EP-<b>&', customer: { name: '<script>alert(1)</script> & co', governorate: 'a<b', district: 'c>d', landmark: 'e&f', notes: '<i>x</i> & "y"' } }],
  ['empty district (address joins the non-empty parts)', { customer: { district: '' } }],
  ['empty name string, blank notes', { customer: { name: '', notes: '   ' } }],
  ['phone with punctuation', { customer: { phone: '+964 (770) 123-4567' } }],
  ['time just before Baghdad midnight', { createdAt: '2026-11-09T20:59:00.000Z' }],
  ['time just after Baghdad midnight', { createdAt: '2026-11-09T21:00:00.000Z' }],
  ['afternoon time', { createdAt: '2026-06-15T13:45:30.000Z' }],
  ['long fields are clipped (name 60, governorate 30, district 80, landmark 120, notes 300)', { customer: { name: 'ن'.repeat(200), governorate: 'م'.repeat(200), district: 'ق'.repeat(200), landmark: 'ع'.repeat(400), notes: 'ل'.repeat(3_000) } }],
  ['overflow drops the notes', { customer: { name: '<'.repeat(60), governorate: '<'.repeat(30), district: '<'.repeat(80), landmark: '<'.repeat(120), notes: 'NOTESMARK' } }],
  ['overflow even without notes is cut at a line boundary', { customer: { name: '&'.repeat(60), governorate: '&'.repeat(30), district: '&'.repeat(80), landmark: '&'.repeat(120) } }],
  ['astral characters are clipped by code point', { customer: { name: '😀'.repeat(100), notes: '🎉'.repeat(400) } }],
];

describe('golden: buildCaption (Telegram HTML caption)', () => {
  it('matrix', () => {
    const out: Record<string, { length: number; text: string }> = {};
    for (const [name, over] of CAPTION_CASES) {
      const text = buildCaption(rec(over), DEFAULT_SETTINGS);
      out[name] = { length: text.length, text: visible(text) };
    }
    expect(out).toMatchSnapshot();
  });
  it('does not depend on settings', () => {
    const other: ShopSettings = { ...DEFAULT_SETTINGS, shopName: 'X', telegramChatId: '999', pricesPublished: false, deliveryFeeIqd: 1 };
    expect(buildCaption(rec(), other)).toBe(buildCaption(rec(), DEFAULT_SETTINGS));
  });
});

type Captured = { url: string; method: string | undefined; hasAbortSignal: boolean; otherInitKeys: string[]; body: Record<string, unknown> };

async function capture(call: [unknown, RequestInit | undefined]): Promise<Captured> {
  const [url, init] = call;
  const form = init?.body as FormData;
  const body: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') body[key] = visible(value);
    else {
      const bytes = new Uint8Array(await value.arrayBuffer());
      body[key] = { file: value.name, type: value.type, size: value.size, sha256: sha256(bytes) };
    }
  }
  return {
    url: String(url).replaceAll(TOKEN, '<TOKEN>'),
    method: init?.method,
    hasAbortSignal: init?.signal instanceof AbortSignal,
    otherInitKeys: Object.keys(init ?? {})
      .filter((k) => !['method', 'body', 'signal'].includes(k))
      .sort(),
    body,
  };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 1, 2, 3, 4, 5]);

describe('golden: Telegram transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));

  it('notifyShop: exact sendDocument request for several records', async () => {
    track(setupEnv({ ORDER_TRANSPORT: 'telegram', TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '-1001234567890' }));
    const picks = [0, 1, 3, 6, 8];
    const out: Record<string, unknown> = {};
    for (const i of picks) {
      const [name, over] = CAPTION_CASES[i];
      const fetchMock = okFetch();
      vi.stubGlobal('fetch', fetchMock);
      const record = rec(over);
      const result = await notifyShop(record, PDF, `${record.displayNo}_file_x${record.price.sheets}.pdf`, DEFAULT_SETTINGS);
      out[name] = {
        result,
        fetchCalls: fetchMock.mock.calls.length,
        request: await capture(fetchMock.mock.calls[0] as unknown as [unknown, RequestInit]),
      };
    }
    expect(out).toMatchSnapshot();
  });

  it('chat id resolution, missing token, and every failure mode', async () => {
    const withChat: ShopSettings = { ...DEFAULT_SETTINGS, telegramChatId: '777' };
    const run = async (
      label: string,
      env: Record<string, string>,
      settings: ShopSettings,
      fetchImpl: (...a: unknown[]) => Promise<Response>,
    ): Promise<[string, unknown]> => {
      track(setupEnv({ ORDER_TRANSPORT: 'telegram', ...env }));
      const fetchMock = vi.fn(fetchImpl);
      vi.stubGlobal('fetch', fetchMock);
      const result = await notifyShop(rec(), PDF, 'EP-1.pdf', settings);
      const first = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit] | undefined;
      const req = first ? await capture(first) : null;
      return [label, { result, fetchCalls: fetchMock.mock.calls.length, url: req?.url ?? null, chat_id: req?.body.chat_id ?? null }];
    };
    const ok = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    const rows = [
      await run('env chat id wins over settings', { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '555' }, withChat, ok),
      await run('falls back to settings chat id', { TELEGRAM_BOT_TOKEN: TOKEN }, withChat, ok),
      await run('no chat id anywhere -> skipped', { TELEGRAM_BOT_TOKEN: TOKEN }, DEFAULT_SETTINGS, ok),
      await run('chat id but no token -> failed', { TELEGRAM_CHAT_ID: '555' }, DEFAULT_SETTINGS, ok),
      await run('HTTP 400 with description', { TELEGRAM_BOT_TOKEN: TOKEN }, withChat, async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 })),
      await run('HTTP 200 but ok:false', { TELEGRAM_BOT_TOKEN: TOKEN }, withChat, async () => new Response(JSON.stringify({ ok: false }), { status: 200 })),
      await run('HTTP 200 non-JSON body', { TELEGRAM_BOT_TOKEN: TOKEN }, withChat, async () => new Response('<html>', { status: 200 })),
      await run('HTTP 502 non-JSON body', { TELEGRAM_BOT_TOKEN: TOKEN }, withChat, async () => new Response('Bad Gateway', { status: 502 })),
      await run('HTTP 200 JSON without ok field', { TELEGRAM_BOT_TOKEN: TOKEN }, withChat, async () => new Response('{}', { status: 200 })),
      await run('fetch throws (token is redacted from the error)', { TELEGRAM_BOT_TOKEN: TOKEN }, withChat, async () => {
        throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/sendDocument`);
      }),
      await run('fetch throws a non-Error', { TELEGRAM_BOT_TOKEN: TOKEN }, withChat, async () => {
        throw 'plain string failure';
      }),
    ];
    expect(Object.fromEntries(rows)).toMatchSnapshot();
  });

  it('sendTelegram called directly (cfg argument)', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const a = await sendTelegram(rec(), PDF, 'a.pdf', DEFAULT_SETTINGS, {});
    const b = await sendTelegram(rec(), PDF, 'a.pdf', DEFAULT_SETTINGS, { chatId: '1' });
    const c = await sendTelegram(rec(), PDF, 'a.pdf', { ...DEFAULT_SETTINGS, telegramChatId: '2' }, { token: TOKEN, chatId: '' });
    expect({
      noChatNoToken: a,
      chatNoToken: b,
      settingsChatWithToken: c,
      fetchCalls: fetchMock.mock.calls.length,
      request: await capture(fetchMock.mock.calls[0] as unknown as [unknown, RequestInit]),
    }).toMatchSnapshot();
  });

  it('console transport: logs "[order] <file> (<n> bytes)\\n<caption>" and skips', async () => {
    track(setupEnv());
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await notifyShop(rec(), PDF, 'EP-251107-AB3C_circle-30x30mm_x20.pdf', DEFAULT_SETTINGS);
    expect({
      result,
      fetchCalls: fetchMock.mock.calls.length,
      logged: log.mock.calls.map((args) => args.map((a) => visible(String(a)))),
    }).toMatchSnapshot();
  });

  it('never throws: an invalid environment becomes a failed result', async () => {
    track(setupEnv({ ORDER_TRANSPORT: 'carrier-pigeon' }));
    const result = await notifyShop(rec(), PDF, 'x.pdf', DEFAULT_SETTINGS);
    process.env.ORDER_TRANSPORT = 'console';
    expect(result).toMatchSnapshot();
  });
});

describe('golden: record material labels', () => {
  it('caption material line per material', () => {
    const materials: Material[] = ['paper', 'plastic'];
    expect(
      materials.map((m) =>
        buildCaption(rec({ price: { material: m } }), DEFAULT_SETTINGS)
          .split('\n')
          .slice(4, 6)
          .join(' | '),
      ),
    ).toMatchSnapshot();
  });
});
